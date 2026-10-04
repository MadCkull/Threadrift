import test from "node:test";
import assert from "node:assert/strict";
import { computeTopology, createRouteGeometry, getActiveRoute, parseGraphDocument, sampleCamera, sampleRoute, serializeGraphDocument, type GraphJSON } from "../src";

function fixture(): GraphJSON {
  return { version: "4.0", root: 0, nextNodeId: 4, nodes: {
    0: { id: 0, name: "Root", content: "", x: 0, y: 0 },
    1: { id: 1, name: "A", content: "", x: 100, y: 300 },
    2: { id: 2, name: "B", content: "", x: -200, y: 300 },
    3: { id: 3, name: "Merge", content: "", x: 0, y: 700 },
  }, edges: [
    { id: "a", from: 0, to: 1, type: "main", curve: .8 },
    { id: "b", from: 0, to: 2, type: "branch", curve: -.8 },
    { id: "am", from: 1, to: 3, type: "main", curve: .6 },
    { id: "bm", from: 2, to: 3, type: "branch", curve: -.6 },
    { id: "parallel", from: 0, to: 1, type: "branch", curve: -.8 },
  ] };
}
function geometry(input = fixture(), choices = {}) {
  const g = parseGraphDocument(input), { sequences } = computeTopology(g);
  return createRouteGeometry(g, sequences, getActiveRoute(g, choices));
}
test("all old versions retain exact path-follow samples and authored fields", () => {
  for (const version of ["1.0", "2.0", "3.0", "4.0"]) {
    const g = fixture(); g.version = version;
    const route = geometry(g);
    for (let i = 0; i <= 200; i++) {
      const p = i / 100, expected = sampleRoute(route, p), actual = sampleCamera(route, p);
      assert.equal(actual.x, expected.x); assert.equal(actual.y, expected.y);
    }
    assert.equal(parseGraphDocument(g).version, "4.0");
    assert.equal(parseGraphDocument(g).nodes[0].camera, undefined);
  }
});
test("views roundtrip deeply detached and old versions reject new authoring fields", () => {
  const g = fixture(); g.nodes[0].camera = { x: 0, y: -100 }; g.edges[0].camera = { mode: "direct", start: .2, end: .8 };
  const doc = parseGraphDocument(g);
  const out = serializeGraphDocument({ graph: doc, nextNodeId: doc.nextNodeId, settings: doc.settings });
  assert.deepEqual(parseGraphDocument(JSON.parse(JSON.stringify(out))), out);
  doc.nodes[0].camera!.x = 900; doc.edges[0].camera!.start = .3;
  assert.equal(out.nodes[0].camera!.x, 0); assert.equal(out.edges[0].camera!.start, .2);
  for (const version of ["1.0", "2.0", "3.0"]) assert.throws(() => parseGraphDocument({ ...g, version }), /camera/);
});
test("malformed views and schedules are rejected without mutating the document", () => {
  for (const camera of [null, {}, { x: 0 }, { x: 0, y: 0, zoom: 2 }, { x: NaN, y: 0 }, { x: 1e10, y: 0 }, { x: "1", y: 2 }]) {
    const g = fixture(); g.nodes[0].camera = camera as any;
    assert.throws(() => parseGraphDocument(g), /camera|finite JSON/);
  }
  for (const camera of [null, {}, { mode: "hold", start: 0, end: 1 }, { mode: "path", start: .5, end: .5 }, { mode: "direct", start: -.1, end: 1 }, { mode: "direct", start: 0, end: 1.1 }, { mode: "direct", start: 0, end: 1, extra: true }]) {
    const g = fixture(); g.edges[0].camera = camera as any;
    assert.throws(() => parseGraphDocument(g), /camera/);
  }
});
test("mixed saved/follow views reach exact endpoints through forks, merges and parallel edges", () => {
  const g = fixture(); g.nodes[0].camera = { x: -80, y: -60 }; g.nodes[3].camera = { x: 500, y: 500 };
  for (const routeId of ["a", "b", "parallel"]) {
    const route = geometry(g, { 0: routeId });
    assert.equal(route.edges[0].id, routeId);
    for (let i = 0; i < route.nodes.length; i++) {
      const node = route.nodes[i], actual = sampleCamera(route, i);
      assert.deepEqual(actual, node.camera ?? { x: node.x, y: node.y });
      if (i) assert(Math.hypot(sampleCamera(route, i - 1e-8).x - actual.x, sampleCamera(route, i - 1e-8).y - actual.y) < .001);
    }
    const forward = Array.from({ length: 201 }, (_, i) => sampleCamera(route, i / 100));
    assert.deepEqual(Array.from({ length: 201 }, (_, i) => sampleCamera(route, (200 - i) / 100)).reverse(), forward);
  }
});
test("equal authored centers hold on curved paths while graph distance still advances", () => {
  const g = fixture(); g.nodes[0].camera = g.nodes[1].camera = { x: 12, y: -10 };
  const route = geometry(g, { 0: "a" });
  for (let i = 0; i <= 100; i++) assert.deepEqual(sampleCamera(route, i / 100), { x: 12, y: -10 });
  assert(sampleRoute(route, .75).distance > sampleRoute(route, .25).distance);
});
test("direct and path movement windows hold endpoints and retrace in reverse", () => {
  for (const mode of ["path", "direct"] as const) {
    const g = fixture(); g.nodes[0].camera = { x: -50, y: 60 }; g.nodes[1].camera = { x: 450, y: -100 };
    g.edges[0].camera = { mode, start: .25, end: .75 };
    const route = geometry(g, { 0: "a" });
    for (const p of [0, .1, .25]) assert.deepEqual(sampleCamera(route, p), g.nodes[0].camera);
    for (const p of [.75, .9, 1]) assert.deepEqual(sampleCamera(route, p), g.nodes[1].camera);
    if (mode === "direct") assert.deepEqual(sampleCamera(route, .5), { x: 200, y: -20 });
    else assert.notDeepEqual(sampleCamera(route, .5), { x: 200, y: -20 });
  }
});
test("empty/single-node maps and clamped endpoints remain defined", () => {
  assert.deepEqual(sampleCamera(null, 0), { x: 0, y: 0 });
  const g = fixture(); g.nodes = { 0: { ...g.nodes[0], camera: { x: -12, y: 30 } } }; g.edges = [];
  const route = geometry(g);
  for (const p of [0, 4, -1, NaN, Infinity]) assert.deepEqual(sampleCamera(route, p), { x: -12, y: 30 });
});
