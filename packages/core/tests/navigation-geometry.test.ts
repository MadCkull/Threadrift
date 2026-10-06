import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeTopology, createRouteGeometry, distanceToProgress, getActivePath,
  getActiveRoute, getRecommendedEdge, getPathLength, progressToDistance, sampleRoute,
  validateGraphData, validateGraphJSON, getNodeEditCapabilities,
  parseGraphDocument, serializeGraphDocument, DEFAULT_DOCUMENT_SETTINGS, PHYSICS_BOUNDS,
  type GraphJSON,
} from "../src";

function graph(): GraphJSON {
  return {
    version: "1.0", nextNodeId: 4, root: 0,
    nodes: Object.fromEntries([
      [0, 0, 0], [1, 120, 300], [2, -120, 300], [3, 0, 650],
    ].map(([id, x, y]) => [id, { id, x, y, name: `Node ${id}`, content: "" }])),
    edges: [
      { id: "main", from: 0, to: 1, type: "main", curve: 0 },
      { id: "left", from: 0, to: 2, type: "branch", curve: .8 },
      { id: "right-merge", from: 1, to: 3, type: "main", curve: 0 },
      { id: "left-merge", from: 2, to: 3, type: "branch", curve: 0 },
      { id: "parallel", from: 0, to: 1, type: "branch", curve: -1 },
    ],
  };
}

test("validation accepts DAG merges and parallel connections without mutation", () => {
  const value = graph();
  const before = JSON.stringify(value);
  assert.equal(validateGraphJSON(value), value);
  assert.equal(JSON.stringify(value), before);
});

for (const [name, mutate, message] of [
  ["root", (g: GraphJSON) => { g.root = 99; }, /root/],
  ["duplicate edge", (g: GraphJSON) => { g.edges[1].id = "main"; }, /duplicate edge/],
  ["duplicate node", (g: GraphJSON) => { g.nodes[1].id = 0; }, /matching.*ID/],
  ["missing endpoint", (g: GraphJSON) => { g.edges[0].to = 99; }, /endpoints/],
  ["cycle", (g: GraphJSON) => { g.edges.push({ id: "loop", from: 3, to: 0, type: "branch", curve: 0 }); }, /cycles/],
  ["disconnected cycle", (g: GraphJSON) => { g.nodes[4] = { id: 4, x: 900, y: 900, name: "x", content: "" }; g.nextNodeId = 5; g.edges.push({ id: "self", from: 4, to: 4, type: "branch", curve: 0 }); }, /cycles/],
  ["coordinate", (g: GraphJSON) => { g.nodes[1].x = Infinity; }, /coordinates/],
  ["curve", (g: GraphJSON) => { g.edges[0].curve = NaN; }, /curve/],
  ["optional curve", (g: GraphJSON) => { g.edges[0].diverge = Infinity; }, /diverge/],
  ["anchor", (g: GraphJSON) => { g.nodes[1].anchorScale = 0; }, /anchorScale/],
  ["node counter", (g: GraphJSON) => { g.nextNodeId = 2; }, /nextNodeId/],
  ["coincident positions", (g: GraphJSON) => { g.nodes[1].x = 0; g.nodes[1].y = 0; }, /zero-length/],
  ["near-zero travel", (g: GraphJSON) => { g.nodes[1].x = 1e-8; g.nodes[1].y = 0; }, /zero-length/],
] as const) {
  test(`validation rejects ${name}`, () => {
    const value = graph();
    mutate(value);
    assert.throws(() => validateGraphJSON(value), message);
  });
}

test("invalid container shapes yield useful validation errors", () => {
  for (const value of [null, [], 4, {}, { nodes: [], edges: {} }]) assert.throws(() => validateGraphData(value), /Invalid Threadrift graph/);
});

test("traversal ignores choices belonging to other origins and retains exact edge IDs", () => {
  const value = graph();
  assert.deepEqual(getActivePath(value, { 0: "left-merge" }).map((node) => node.id), [0, 1, 3]);
  assert.deepEqual(getActiveRoute(value, { 0: "parallel" }).edges.map((edge) => edge.id), ["parallel", "right-merge"]);
});

test("unsafe callers cannot hang traversal with a cycle or missing endpoint", () => {
  const value = graph();
  value.edges.push({ id: "loop", from: 3, to: 0, type: "main", curve: 0 });
  assert.deepEqual(getActivePath(value, {}).map((node) => node.id), [0, 1, 3]);
  value.edges[0].to = 99;
  assert.equal(getActiveRoute(value, {}).edges[0].id, "left", "invalid destinations must not prevent a valid fallback");
});

test("arc distance round trips and samples exact node endpoints", () => {
  const value = graph();
  const { sequences } = computeTopology(value);
  const route = getActiveRoute(value, { 0: "left" });
  const before = JSON.stringify(value);
  const geometry = createRouteGeometry(value, sequences, route);
  assert.equal(JSON.stringify(value), before);
  assert.ok(geometry.totalLength > Math.hypot(120, 300) + Math.hypot(120, 350));
  for (let p = 0; p <= 2; p += 0.025) {
    assert.ok(Math.abs(distanceToProgress(geometry, progressToDistance(geometry, p)) - p) < 1e-10);
  }
  for (let index = 0; index < route.nodes.length; index++) {
    const sample = sampleRoute(geometry, index);
    assert.equal(sample.x, route.nodes[index].x);
    assert.equal(sample.y, route.nodes[index].y);
    assert.equal(distanceToProgress(geometry, geometry.nodeDistances[index]), index);
  }
  const middle = sampleRoute(geometry, .5);
  assert.equal(middle.edgeId, "left");
  assert.ok(Math.abs(middle.x - -60) > 1, "curved position must differ from endpoint chord");
  assert.equal(progressToDistance(geometry, Infinity), geometry.totalLength);
  assert.equal(progressToDistance(geometry, NaN), 0);
  assert.equal(distanceToProgress(geometry, -100), 0);
});

test("parallel edges retain different geometry and provider/revision cache identity", () => {
  const value = graph();
  const { sequences } = computeTopology(value);
  const main = createRouteGeometry(value, sequences, getActiveRoute(value, {}));
  const parallel = createRouteGeometry(value, sequences, getActiveRoute(value, { 0: "parallel" }));
  assert.notDeepEqual(sampleRoute(main, .5), sampleRoute(parallel, .5));
  const first = getPathLength("shared-id", "M 0 0 L 0 10");
  const second = getPathLength("shared-id", "M 0 0 L 0 200");
  assert.equal(first, 10);
  assert.equal(second, 200);
  assert.equal(getPathLength("shared-id", "M 0 0 L 0 10"), first);
});

test("empty and single-node route samples are finite and bad continuity is rejected", () => {
  const value = graph();
  const empty = createRouteGeometry(value, [], { nodes: [], edges: [] });
  assert.equal(distanceToProgress(empty, 100), 0);
  assert.deepEqual(sampleRoute(empty, NaN), { x: 0, y: 0, edgeId: undefined, fraction: 0, distance: 0 });
  const one = createRouteGeometry(value, [], { nodes: [value.nodes[1]], edges: [] });
  assert.equal(sampleRoute(one, 10).y, 300);
  assert.throws(() => createRouteGeometry(value, [], { nodes: [value.nodes[0]], edges: [value.edges[0]] }), /continuous/);
});

function continuationGraph(): GraphJSON {
  return {
    version: "1.0", root: 0, nextNodeId: 8,
    nodes: Object.fromEntries([
      [0, 0, 0], [1, -100, 100], [2, 100, 100], [3, 0, 200],
      [4, 100, 300], [5, -100, 300], [6, 0, 450], [7, 200, 400],
    ].map(([id, x, y]) => [id, { id, x, y, name: `Node ${id}`, content: "" }])),
    edges: [
      { id: "start-left", from: 0, to: 1, type: "main", curve: 0 },
      { id: "start-right", from: 0, to: 2, type: "branch", curve: 0 },
      { id: "left-arrival", from: 1, to: 3, type: "branch", curve: 0 },
      { id: "right-arrival", from: 2, to: 3, type: "branch", curve: 0 },
      { id: "continue-right", from: 3, to: 4, type: "branch", curve: 0 },
      { id: "continue-left", from: 3, to: 5, type: "branch", curve: 0 },
      { id: "vertical-main", from: 3, to: 6, type: "main", curve: 0 },
      { id: "farther-right", from: 3, to: 7, type: "branch", curve: 0 },
    ],
  };
}

test("automatic routes continue through forks without a main edge or explicit choice", () => {
  const value = continuationGraph();
  value.edges = value.edges.filter(edge => edge.type !== "main");
  const choices = {};
  assert.deepEqual(getActiveRoute(value, choices).nodes.map(node => node.id), [0, 2, 3, 5]);
  assert.deepEqual(choices, {}, "automatic routing must not become an explicit user choice");
});

test("incoming route at a merge determines the straight continuation", () => {
  const value = continuationGraph();
  computeTopology(value);
  assert.deepEqual(getActiveRoute(value, {}).nodes.map(node => node.id), [0, 1, 3, 4]);
  assert.deepEqual(getActiveRoute(value, { 0: "start-right" }).nodes.map(node => node.id), [0, 2, 3, 5]);
  assert.equal(getRecommendedEdge(value, 3, value.edges.find(edge => edge.id === "left-arrival"))?.id, "continue-right");
});

test("author recommendation overrides automatic geometry, explicit user choice overrides both", () => {
  const value = continuationGraph();
  value.nodes[3].recommendedEdgeId = "continue-left";
  const persisted = JSON.parse(JSON.stringify(validateGraphJSON(value)));
  assert.equal(persisted.nodes[3].recommendedEdgeId, "continue-left");
  assert.equal(getActiveRoute(value, {}).edges.at(-1)?.id, "continue-left");
  assert.equal(getActiveRoute(value, { 3: "vertical-main" }).edges.at(-1)?.id, "vertical-main");
  assert.equal(getActiveRoute(value, { 3: "unknown" }).edges.at(-1)?.id, "continue-left");
});

test("automatic ties choose shortest aligned exit, then stable edge ID independent of array order", () => {
  const value = continuationGraph();
  value.edges.push({ id: "a-parallel", from: 3, to: 4, type: "branch", curve: 1 });
  assert.equal(getActiveRoute(value, {}).edges.at(-1)?.id, "a-parallel");
  value.edges.reverse();
  assert.equal(getActiveRoute(value, {}).edges.at(-1)?.id, "a-parallel");
  value.nodes[0].recommendedEdgeId = "start-right";
  assert.equal(getActiveRoute(value, {}).edges[0].id, "start-right", "root recommendations override main defaults");
});

test("root without incoming heading prefers main, then shortest exit and stable ID", () => {
  const value = continuationGraph();
  value.nodes[1].x = -500;
  assert.equal(getRecommendedEdge(value, 0)?.id, "start-left");
  value.edges[0].type = "branch";
  assert.equal(getRecommendedEdge(value, 0)?.id, "start-right");
  assert.equal(getRecommendedEdge(value, 0, value.edges[2])?.id, "start-right", "foreign incoming edge cannot supply a heading");
});

test("invalid recommendation metadata is rejected while unsafe traversal falls back safely", () => {
  for (const recommendation of ["missing", "left-arrival", "", null, 42]) {
    const value = continuationGraph();
    (value.nodes[3] as unknown as Record<string, unknown>).recommendedEdgeId = recommendation;
    assert.throws(() => validateGraphJSON(value), /recommendedEdgeId.*owned/);
    assert.equal(getActiveRoute(value, {}).edges.at(-1)?.id, "continue-right");
  }
  const value = continuationGraph();
  value.nodes[3].recommendedEdgeId = undefined;
  assert.equal(validateGraphJSON(value), value);
});

test("document migrates legacy exports, strips computed fields and preserves authored data", () => {
  const legacy = graph();
  computeTopology(legacy);
  legacy.nodes[0].anchorX = 12;
  legacy.nodes[0].anchorY = -30;
  legacy.nodes[0].anchorScale = 1.6;
  legacy.nodes[0].recommendedEdgeId = "left";
  legacy.edges[1].curveEnd = .4;
  legacy.edges[1].diverge = -.2;
  const before = JSON.stringify(legacy);
  const document = parseGraphDocument(legacy);
  assert.equal(document.version, "4.0");
  assert.deepEqual(document.settings, DEFAULT_DOCUMENT_SETTINGS);
  assert.equal(JSON.stringify(legacy), before);
  for (const node of Object.values(document.nodes)) for (const field of ["level", "seqId", "parentSeqId", "vx", "vy"]) assert.equal(Object.hasOwn(node, field), false);
  assert.deepEqual(document.nodes[0], { id: 0, x: 0, y: 0, name: "Node 0", content: "", anchorX: 12, anchorY: -30, recommendedEdgeId: "left" });
  assert.equal(document.edges[1].curveEnd, .4);
  assert.equal(document.edges[1].diverge, -.2);
});

test("document round trip detaches every persisted setting, extension and graph value", () => {
  const document = parseGraphDocument(graph());
  document.settings = { physics: { scrollSensitivity: .006, touchSensitivity: .012, snapStrength: 0, snapThreshold: .5 }, editor: { autoSaveEnabled: false }, extensions: { "example.editor": { theme: "dark" } } };
  document.extensions = { "example.story": { title: "Story", tags: ["a", true, null, 2] } };
  document.nodes[0].extensions = { "example.node": { nested: [1, { ok: true }] } };
  document.edges[0].extensions = { "example.edge": { weight: 2 } };
  computeTopology(document);
  const output = serializeGraphDocument({ graph: document, nextNodeId: document.nextNodeId, settings: document.settings, extensions: document.extensions });
  assert.deepEqual(parseGraphDocument(JSON.parse(JSON.stringify(output))), output);
  document.settings.physics.touchSensitivity = .001;
  document.settings.editor.autoSaveEnabled = true;
  document.nodes[0].name = "Edited later";
  (document.nodes[0].extensions!["example.node"] as { nested: unknown[] }).nested[0] = 9;
  document.edges[0].extensions!["example.edge"] = null;
  document.extensions["example.story"] = null;
  assert.equal(output.settings.physics.touchSensitivity, .012);
  assert.equal(output.settings.editor.autoSaveEnabled, false);
  assert.equal(output.nodes[0].name, "Node 0");
  assert.deepEqual(output.nodes[0].extensions, { "example.node": { nested: [1, { ok: true }] } });
  assert.deepEqual(output.edges[0].extensions, { "example.edge": { weight: 2 } });
  assert.deepEqual(output.extensions, { "example.story": { title: "Story", tags: ["a", true, null, 2] } });
});

test("missing nested settings migrate independently without sharing mutable defaults", () => {
  const value = graph();
  value.settings = { physics: { scrollSensitivity: .005 }, editor: {} };
  const first = parseGraphDocument(value);
  const second = parseGraphDocument(value);
  assert.equal(first.settings.physics.scrollSensitivity, .005);
  assert.equal(first.settings.physics.touchSensitivity, DEFAULT_DOCUMENT_SETTINGS.physics.touchSensitivity);
  first.settings.physics.snapStrength = .99;
  first.settings.editor.autoSaveEnabled = false;
  assert.equal(second.settings.physics.snapStrength, DEFAULT_DOCUMENT_SETTINGS.physics.snapStrength);
  assert.equal(second.settings.editor.autoSaveEnabled, true);
});

test("anchor width roundtrips and v3 rejects scaling while migrating older anchors", () => {
  for (const version of ["1.0", "2.0"]) {
    const old = graph(); old.version = version;
    old.nodes[0].anchorScale = 1.7;
    old.nodes[0].anchorX = 0; old.nodes[0].anchorY = -12;
    old.nodes[0].anchorWidth = 480;
    const migrated = parseGraphDocument(old);
    assert.equal(migrated.version, "4.0");
    assert.equal(migrated.nodes[0].anchorWidth, 480);
    assert.equal(migrated.nodes[0].anchorX, 0);
    assert.equal(migrated.nodes[0].anchorY, -12);
    assert.equal("anchorScale" in migrated.nodes[0], false);
    assert.deepEqual(parseGraphDocument(JSON.parse(JSON.stringify(migrated))), migrated);
    old.version = "3.0";
    assert.throws(() => parseGraphDocument(old), /anchorScale/);
  }
  for (const width of [0, -1, NaN, Infinity, "320", null]) {
    const invalid = graph(); invalid.nodes[0].anchorWidth = width as number;
    assert.throws(() => parseGraphDocument(invalid), /anchorWidth|finite JSON/);
  }
});

test("document rejects unknown versions, durable fields, settings and out-of-range numbers", () => {
  for (const version of ["0.9", "5.0", "", 2, null]) assert.throws(() => parseGraphDocument({ ...graph(), version }), /version/);
  for (const key of Object.keys(PHYSICS_BOUNDS)) for (const value of [NaN, Infinity, -1, 20, "0.1", null]) {
    assert.throws(() => parseGraphDocument({ ...graph(), settings: { physics: { [key]: value } } }), /finite|between/);
  }
  assert.throws(() => parseGraphDocument({ ...graph(), settings: { editor: { autoSaveEnabled: "false" } } }), /boolean/);
  assert.throws(() => parseGraphDocument({ ...graph(), runtimeCamera: {} }), /not supported/);
  assert.throws(() => parseGraphDocument({ ...graph(), settings: { physics: { friction: .1 } } }), /not supported/);
  assert.throws(() => parseGraphDocument({ ...graph(), settings: { editor: { open: true } } }), /not supported/);
  const value = graph();
  (value.nodes[0] as unknown as Record<string, unknown>).extra = "never silently drop";
  assert.throws(() => parseGraphDocument(value), /not supported/);
  delete (value.nodes[0] as unknown as Record<string, unknown>).extra;
  (value.edges[0] as unknown as Record<string, unknown>).extra = "never silently drop";
  assert.throws(() => parseGraphDocument(value), /not supported/);
});

test("extension data rejects silent JSON coercion, prototypes, sparse arrays and unsafe properties", () => {
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  const accessor = Object.defineProperty({}, "secret", { enumerable: true, get() { throw new Error("must never invoke accessor"); } });
  for (const data of [undefined, NaN, Infinity, () => 1, Symbol("x"), 1n, new Date(), new Map(), cyclic, accessor, new Array(2), Object.create({ inherited: true }), JSON.parse('{"__proto__":{"polluted":true}}')]) {
    assert.throws(() => parseGraphDocument({ ...graph(), extensions: { "example.test": data } }), /JSON|cycle|data property|sparse/);
  }
  assert.throws(() => parseGraphDocument({ ...graph(), extensions: [] }), /extensions must/);
  assert.throws(() => parseGraphDocument({ ...graph(), settings: { extensions: "bad" } }), /extensions must/);
  const value = graph();
  (value.nodes[0] as unknown as Record<string, unknown>).extensions = null;
  assert.throws(() => parseGraphDocument(value), /extensions must/);
});

test("runtime serialization omits cleared optional and computed fields but rejects unsupported data", () => {
  const value = graph();
  value.nodes[0].recommendedEdgeId = undefined;
  value.nodes[0].vx = undefined;
  value.edges[0].curveEnd = undefined;
  const output = serializeGraphDocument({ graph: value, nextNodeId: value.nextNodeId, settings: parseGraphDocument(graph()).settings });
  assert.equal(Object.hasOwn(output.nodes[0], "recommendedEdgeId"), false);
  assert.equal(Object.hasOwn(output.nodes[0], "vx"), false);
  assert.equal(Object.hasOwn(output.edges[0], "curveEnd"), false);
  (value.nodes[0] as unknown as Record<string, unknown>).futureData = 1;
  assert.throws(() => serializeGraphDocument({ graph: value, nextNodeId: value.nextNodeId, settings: output.settings }), /unsupported graph property/);
});

test("document validation checks geometry on branches outside the default route", () => {
  const value = graph();
  value.edges.find(edge => edge.id === "left")!.curve = Number.MAX_VALUE;
  assert.throws(() => parseGraphDocument(value), /derived geometry/);
});


test("editor actions respect hierarchy, main exits, and merge topology", () => {
  const value = graph(); computeTopology(value);
  assert.equal(getNodeEditCapabilities(value, 0).canAddMain, false);
  assert.equal(getNodeEditCapabilities(value, 0).canAddBranch, true);
  assert.deepEqual(getNodeEditCapabilities(value, 0).mergeTargets, [3]);
  assert.deepEqual(getNodeEditCapabilities(value, 3).mergeTargets, []);
  value.nodes[2].level = 3;
  assert.equal(getNodeEditCapabilities(value, 2).canAddMain, true);
  assert.equal(getNodeEditCapabilities(value, 2).canAddBranch, false);
  assert.deepEqual(getNodeEditCapabilities(value, 2).mergeTargets, [1]);
  value.nodes[1].x = value.nodes[2].x; value.nodes[1].y = value.nodes[2].y;
  assert.deepEqual(getNodeEditCapabilities(value, 2).mergeTargets, []);
  assert.deepEqual(getNodeEditCapabilities(value, 999), { canAddMain: false, canAddBranch: false, mergeTargets: [] });
});
