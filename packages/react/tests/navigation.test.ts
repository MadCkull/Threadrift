import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "zustand/vanilla";
import type { GraphJSON, GraphEdge } from "@threadrift/core";
import { createThreadriftStore } from "../src/store/threadrift-store";
import { normalizeWheelDelta, clampInputDelta, WheelSessionTracker, WheelReversePause, shouldCancelPointerCapture, isFreshReverseWheelIntent } from "../src/input/native-input";
import showcase from "./fixtures/sample-map.json";

function fixture(): GraphJSON {
  // 0 -> A(1) -> right(2) -> merge(4) -> finish(5)
  //       |       | nested(6) -> 7 ------^
  //       left(3) ----------------> 4
  //       | nested(8) -> 9 (dead end); node 3 has branch-only exits
  // 4 also branches to 10 -> 5. Node 11 is disconnected.
  const edge = (from: number, to: number, type: GraphEdge["type"]): GraphEdge => ({
    id: `${from}-${to}`, from, to, type, curve: 0,
  });
  return {
    version: "1.0", root: 0, nextNodeId: 12,
    nodes: Object.fromEntries(Array.from({ length: 12 }, (_, id) => [id, {
      id, name: `Node ${id}`, content: "", x: id * 50, y: id * 100,
    }])),
    edges: [
      edge(0, 1, "main"), edge(1, 2, "main"), edge(2, 4, "main"), edge(4, 5, "main"),
      edge(6, 7, "main"), edge(8, 9, "main"),
      edge(1, 3, "branch"), edge(3, 4, "branch"),
      edge(2, 6, "branch"), edge(7, 5, "branch"),
      edge(3, 8, "branch"), edge(4, 10, "branch"), edge(10, 5, "branch"),
    ],
  };
}

function setup() {
  const store = createStore(createThreadriftStore);
  store.getState().configurePersistence(false);
  store.getState().loadGraph(fixture());
  return store;
}
type Store = ReturnType<typeof setup>;
const path = (store: Store) => store.getState().activePath.map((node) => node.id);
function restAt(store: Store, id: number) {
  const index = path(store).indexOf(id);
  assert(index >= 0, `Node ${id} must be on the current route`);
  store.setState({ scrollTarget: index, scrollCurrent: index, isScrolling: false });
}
function unchanged(store: Store, action: () => void) {
  const before = store.getState();
  let notifications = 0;
  const unsubscribe = store.subscribe(() => notifications++);
  action();
  unsubscribe();
  assert.strictEqual(store.getState(), before, "Rejected input must not mutate any state");
  assert.equal(notifications, 0, "Rejected input must not notify subscribers");
}

const unsettled = [
  { label: "gesture still active at the node", scrollTarget: 1, scrollCurrent: 1, isScrolling: true },
  { label: "halfway to the right branch", scrollTarget: 1.5, scrollCurrent: 1.5, isScrolling: false },
  { label: "target snapped but camera still catching up", scrollTarget: 1, scrollCurrent: 1.05, isScrolling: false },
  { label: "camera almost settled", scrollTarget: 1, scrollCurrent: 1.00001, isScrolling: false },
  { label: "just past the fork", scrollTarget: 1.0001, scrollCurrent: 1.0001, isScrolling: false },
  { label: "target near node while camera is between nodes", scrollTarget: 1.0001, scrollCurrent: 1.4, isScrolling: false },
  { label: "camera at node but target has moved", scrollTarget: 1.2, scrollCurrent: 1, isScrolling: false },
  { label: "returning toward the fork", scrollTarget: 1, scrollCurrent: 1.2, isScrolling: false },
  { label: "invalid index", scrollTarget: 99, scrollCurrent: 99, isScrolling: false },
  { label: "negative index", scrollTarget: -1, scrollCurrent: -1, isScrolling: false },
  { label: "nonfinite target", scrollTarget: Infinity, scrollCurrent: Infinity, isScrolling: false },
  { label: "not-a-number progress", scrollTarget: NaN, scrollCurrent: NaN, isScrolling: false },
];
for (const state of unsettled) {
  test(`node, edge and gesture choices are ignored: ${state.label}`, () => {
    const store = setup();
    store.setState(state);
    unchanged(store, () => store.getState().focusNode(3));
    unchanged(store, () => store.getState().focusEdge("1-3"));
    unchanged(store, () => store.getState().setBranchChoice(1, "1-3"));
  });
}

test("switching at A changes only the untravelled suffix and keeps the camera still", () => {
  const store = setup(); restAt(store, 1);
  store.getState().focusNode(3);
  assert.deepEqual(path(store), [0, 1, 3, 4, 5]);
  assert.equal(store.getState().scrollTarget, 1);
  assert.equal(store.getState().scrollCurrent, 1);
  store.getState().focusEdge("1-2");
  assert.deepEqual(path(store), [0, 1, 2, 4, 5]);
});

test("resting on right child cannot switch to the left sibling or its subtree", () => {
  const store = setup(); restAt(store, 2);
  for (const id of [0, 1, 3, 8, 9]) unchanged(store, () => store.getState().focusNode(id));
  for (const id of ["0-1", "1-2", "1-3", "3-4", "3-8"]) {
    unchanged(store, () => store.getState().focusEdge(id));
  }
  unchanged(store, () => store.getState().setBranchChoice(1, "1-3"));
});

test("a future branch can be selected without rewriting earlier choices", () => {
  const store = setup(); restAt(store, 1);
  store.getState().focusNode(3); restAt(store, 3);
  store.getState().focusNode(10);
  assert.deepEqual(path(store), [0, 1, 3, 4, 10, 5]);
  assert.equal(store.getState().branchChoices[1], "1-3");
  assert.equal(store.getState().scrollCurrent, 2);
});

test("a future edge can be selected through a merge while preserving the travelled branch", () => {
  const store = setup(); restAt(store, 1);
  store.getState().focusNode(3); restAt(store, 3);
  store.getState().focusEdge("4-10");
  assert.deepEqual(path(store), [0, 1, 3, 4, 10, 5]);
});

test("edge clicks choose the exact incoming edge of a merged destination", () => {
  const store = setup(); restAt(store, 1);
  // Node 4 already lies on the default route, but this edge must choose the left route.
  store.getState().focusEdge("3-4");
  assert.deepEqual(path(store), [0, 1, 3, 4, 5]);
  store.getState().focusEdge("2-4");
  assert.deepEqual(path(store), [0, 1, 2, 4, 5]);
});

test("current node does nothing, but an active-future node records explicit route intent", () => {
  const store = setup(); restAt(store, 1);
  unchanged(store, () => store.getState().focusNode(1));
  store.getState().focusNode(5);
  assert.deepEqual(path(store), [0, 1, 2, 4, 5]);
  assert.equal(store.getState().branchChoices[1], "1-2");
  assert.equal(store.getState().branchChoices[2], "2-4");
  assert.equal(store.getState().branchChoices[4], "4-5");
  assert.equal(store.getState().scrollCurrent, 1);
  // Selecting the same explicit route again remains a no-op.
  unchanged(store, () => store.getState().focusEdge("1-2"));
});

test("choosing the previewed main edge records intent without moving", () => {
  const store = setup(); restAt(store, 1);
  const previous = path(store);
  store.getState().focusEdge("1-2");
  assert.equal(store.getState().branchChoices[1], "1-2");
  assert.deepEqual(path(store), previous);
  assert.equal(store.getState().scrollTarget, 1);
  assert.equal(store.getState().scrollCurrent, 1);
});

test("parallel-edge selection preserves exact identity and cannot rewrite a travelled edge", () => {
  const data = fixture();
  data.edges.push({ id: "1-2-alternate", from: 1, to: 2, type: "branch", curve: 120 });
  const store = setup(); store.getState().loadGraph(data); restAt(store, 1);
  store.getState().focusEdge("1-2-alternate");
  assert.equal(store.getState().branchChoices[1], "1-2-alternate");
  assert.deepEqual(path(store), [0, 1, 2, 4, 5]);
  restAt(store, 2);
  unchanged(store, () => store.getState().focusEdge("1-2"));
  unchanged(store, () => store.getState().setBranchChoice(1, "1-2"));
  assert.equal(store.getState().branchChoices[1], "1-2-alternate");
});

test("nested branch switches require rest at their own fork", () => {
  const store = setup(); restAt(store, 1);
  store.getState().focusNode(3); restAt(store, 3);
  store.getState().focusNode(8);
  assert.deepEqual(path(store), [0, 1, 3, 8, 9]);
  store.setState({ scrollCurrent: 2.2, scrollTarget: 2.2 });
  unchanged(store, () => store.getState().focusNode(4));
  unchanged(store, () => store.getState().focusEdge("3-4"));
  restAt(store, 8);
  unchanged(store, () => store.getState().focusNode(4));
  unchanged(store, () => store.getState().focusEdge("3-4"));
  unchanged(store, () => store.getState().setBranchChoice(3, null));
  // Returning all the way to the fork makes switching legal again.
  restAt(store, 3);
  store.getState().focusEdge("3-4");
  assert.deepEqual(path(store), [0, 1, 3, 4, 5]);
});

test("resting at a merge cannot rewrite either of its incoming paths", () => {
  const store = setup(); restAt(store, 4);
  unchanged(store, () => store.getState().focusNode(3));
  unchanged(store, () => store.getState().focusEdge("3-4"));
  unchanged(store, () => store.getState().focusEdge("2-4"));
  store.getState().focusNode(10);
  assert.deepEqual(path(store), [0, 1, 2, 4, 10, 5]);
});

test("disconnected, nonexistent and mismatched targets cause no action", () => {
  const store = setup(); restAt(store, 1);
  for (const id of [11, 999]) unchanged(store, () => store.getState().focusNode(id));
  unchanged(store, () => store.getState().focusEdge("missing"));
  unchanged(store, () => store.getState().setBranchChoice(1, "3-8"));
  unchanged(store, () => store.getState().setBranchChoice(11, null));
});

test("branch choices are published with their matching path in one notification", () => {
  const store = setup(); restAt(store, 1);
  const snapshots: number[][] = [];
  const unsubscribe = store.subscribe((state) => {
    assert.equal(state.branchChoices[1], "1-3");
    snapshots.push(state.activePath.map((node) => node.id));
  });
  store.getState().setBranchChoice(1, "1-3");
  unsubscribe();
  assert.deepEqual(snapshots, [[0, 1, 3, 4, 5]]);
});

test("legacy null main selection records explicit main intent before leaving its fork", () => {
  const store = setup(); restAt(store, 1);
  store.getState().setBranchChoice(1, "1-3");
  store.getState().setBranchChoice(1, null);
  assert.deepEqual(path(store), [0, 1, 2, 4, 5]);
  assert.equal(store.getState().branchChoices[1], "1-2");
});

test("branch-only junctions support either choice at complete rest", () => {
  const data = fixture();
  data.edges.find((edge) => edge.id === "1-2")!.type = "branch";
  const store = setup(); store.getState().loadGraph(data); restAt(store, 1);
  assert.deepEqual(path(store), [0, 1, 2, 4, 5]);
  store.getState().focusEdge("1-3");
  assert.deepEqual(path(store), [0, 1, 3, 4, 5]);
  unchanged(store, () => store.getState().setBranchChoice(1, null));
  store.getState().focusEdge("1-2");
  assert.deepEqual(path(store), [0, 1, 2, 4, 5]);
});

test("empty paths never accept navigation", () => {
  const store = createStore(createThreadriftStore);
  unchanged(store, () => store.getState().focusNode(0));
  unchanged(store, () => store.getState().focusEdge("0-1"));
  unchanged(store, () => store.getState().setBranchChoice(0, "0-1"));
});

/** Deterministic fixtures: a guaranteed route plus varied forward shortcuts/parallel exits. */
function generatedDag(seed: number): GraphJSON {
  let value = seed >>> 0;
  const random = () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const count = 18;
  const nodes = Object.fromEntries(Array.from({ length: count }, (_, id) => [id, {
    id, name: `Generated ${seed}:${id}`, content: "", x: random() * 1000, y: random() * 1000,
    ...(id < count - 1 ? { recommendedEdgeId: `main-${id}` } : {}),
  }]));
  const edges: GraphEdge[] = [];
  for (let from = 0; from < count - 1; from++) {
    edges.push({ id: `main-${from}`, from, to: from + 1, type: "main", curve: 0 });
    for (let branch = 0; branch < Math.floor(random() * 5); branch++) {
      const to = from + 1 + Math.floor(random() * (count - from - 1));
      edges.push({ id: `branch-${from}-${branch}`, from, to, type: "branch", curve: random() * 100 });
    }
  }
  return { version: "1.0", root: 0, nextNodeId: count, nodes, edges };
}

test("generated DAG selections preserve every travelled prefix and exact requested edge", () => {
  for (const seed of [1, 2, 7, 19, 57, 127, 511, 2026]) {
    const data = generatedDag(seed);
    for (const index of [0, 1, 5, 11, 17]) {
      for (const edge of data.edges) {
        const store = setup(); store.getState().loadGraph(structuredClone(data));
        restAt(store, index);
        const before = path(store).slice(0, index + 1);
        if (edge.from < index) {
          unchanged(store, () => store.getState().focusEdge(edge.id));
        } else {
          store.getState().focusEdge(edge.id);
          const selectedPath = path(store);
          assert.deepEqual(selectedPath.slice(0, index + 1), before, `seed ${seed}, edge ${edge.id}`);
          assert.equal(store.getState().branchChoices[edge.from], edge.id);
          assert.equal(store.getState().scrollCurrent, index);
          assert.equal(store.getState().scrollTarget, index);
          assert.equal(new Set(selectedPath).size, selectedPath.length);
        }
      }
    }
  }
});

function settle(store: Store, reducedMotion = false) {
  for (let frame = 0; frame < 240; frame++) store.getState().advanceNavigation(1000 / 60, reducedMotion);
  assert.equal(store.getState().scrollCurrent, store.getState().scrollTarget, "Camera must reach exact target");
}

function gesture(store: Store, delta: number, source: "wheel" | "pointer" | "keyboard" = "wheel") {
  const session = store.getState().beginInput(source);
  assert.notEqual(session, null);
  store.getState().travelInput(delta, session!);
  store.getState().endInput(session!);
  settle(store);
}

test("forward input flows through unchosen forks without creating explicit choices", () => {
  const store = setup();
  const session = store.getState().beginInput("wheel")!;
  store.getState().travelInput(100_000, session);
  settle(store);
  assert.equal(store.getState().activePath[store.getState().scrollCurrent].id, 5);
  assert.deepEqual(store.getState().branchChoices, {});
  unchanged(store, () => store.getState().focusEdge("1-3"));
  store.getState().endInput(session);
  unchanged(store, () => store.getState().travelInput(100_000, session));
  gesture(store, -100_000);
  assert.equal(store.getState().activePath[store.getState().scrollCurrent].id, 4);
});

test("preselected nested route flows to its end without changing any choices", () => {
  const store = setup();
  store.getState().focusEdge("2-6");
  const choices = { ...store.getState().branchChoices };
  gesture(store, 100_000);
  assert.deepEqual(store.getState().branchChoices, choices);
  assert.equal(store.getState().activePath[store.getState().scrollCurrent].id, 5);
  // Reverse retains the actual incoming route and pauses at the nearest fork.
  const traversed = store.getState().activeEdges.map((edge) => edge.id);
  gesture(store, -100_000);
  assert.equal(store.getState().activePath[store.getState().scrollCurrent].id, 2);
  assert.deepEqual(store.getState().activeEdges.map((edge) => edge.id), traversed);
});

test("explicit choice survives slow deltas, acceleration, long tails and rapid reversal", () => {
  const store = setup();
  store.getState().focusEdge("1-3");
  const choices = { ...store.getState().branchChoices };
  const session = store.getState().beginInput("wheel")!;
  const deltas = [...Array(30).fill(0.25), 2, 5, 20, 80, -3, 150, 80, 40, 20, 10, 4, 1, 0.1, 700];
  for (const delta of deltas) {
    store.getState().travelInput(delta, session);
    store.getState().advanceNavigation(1000 / 120, false);
    assert.deepEqual(store.getState().branchChoices, choices);
    assert(store.getState().scrollTarget >= 0 && store.getState().scrollTarget < store.getState().activePath.length);
  }
  store.getState().endInput(session);
  settle(store);
  // The reversal crossed the fork, so it drains the session there even after a later positive spike.
  assert.equal(store.getState().activePath[store.getState().scrollCurrent].id, 1);
  gesture(store, 100_000);
  assert.equal(store.getState().activePath[store.getState().scrollCurrent].id, 5);
});

test("micro-deltas accumulate rather than being discarded at a resting node", () => {
  const store = setup();
  const session = store.getState().beginInput("wheel")!;
  for (let i = 0; i < 100; i++) store.getState().travelInput(0.1, session);
  assert(store.getState().distanceTarget > 9.999 && store.getState().distanceTarget < 10.001);
  assert(store.getState().scrollTarget > 0 && store.getState().scrollTarget < 1);
});

test("competing inputs and stale sessions cannot seize active navigation", () => {
  const store = setup();
  const session = store.getState().beginInput("pointer")!;
  assert.equal(store.getState().beginInput("wheel"), null);
  store.getState().travelInput(10, session);
  store.getState().cancelInput();
  unchanged(store, () => store.getState().travelInput(500, session));
  unchanged(store, () => store.getState().endInput(session));
  const next = store.getState().beginInput("wheel")!;
  assert.notEqual(next, session);
});

test("graph replacement invalidates input and resets a bounded position", () => {
  const store = setup();
  const session = store.getState().beginInput("wheel")!;
  store.getState().travelInput(20, session);
  const revision = store.getState().graphRevision;
  store.getState().loadGraph(fixture());
  assert(store.getState().graphRevision > revision);
  assert.equal(store.getState().inputSession, null);
  assert.equal(store.getState().scrollCurrent, 0);
  assert.equal(store.getState().scrollTarget, 0);
  unchanged(store, () => store.getState().travelInput(500, session));
});

test("reduced-motion controls flow by default and permit optional route choice", () => {
  const store = setup();
  store.getState().stepNavigation(1); settle(store, true);
  assert.equal(store.getState().scrollCurrent, 1);
  store.getState().stepNavigation(1); settle(store, true);
  assert.equal(store.getState().activePath[store.getState().scrollCurrent].id, 2);
  store.getState().stepNavigation(-1); settle(store, true);
  store.getState().focusEdge("1-3");
  store.getState().stepNavigation(1); settle(store, true);
  assert.equal(store.getState().activePath[store.getState().scrollCurrent].id, 3);
  store.getState().stepNavigation(-1); settle(store, true);
  assert.equal(store.getState().activePath[store.getState().scrollCurrent].id, 1);
});

test("wheel pixel, line and page units normalize consistently without losing fractional movement", () => {
  assert.deepEqual(normalizeWheelDelta({ deltaX: 0.125, deltaY: -0.25, deltaMode: 0 }), { x: 0.125, y: -0.25 });
  assert.deepEqual(normalizeWheelDelta({ deltaX: 2, deltaY: -3, deltaMode: 1 }, 20, 600), { x: 40, y: -60 });
  assert.deepEqual(normalizeWheelDelta({ deltaX: 0, deltaY: 1, deltaMode: 2 }, 20, 600), { x: 0, y: 600 });
  for (const value of [NaN, Infinity, -Infinity]) assert.equal(clampInputDelta(value), 0);
  assert.equal(clampInputDelta(100_000), 1200);
  assert.equal(clampInputDelta(-100_000), -1200);
});

test("wheel ownership remains with nested content until a fresh gesture", () => {
  const tracker = new WheelSessionTracker(200);
  assert.deepEqual(tracker.sample(0, false), { fresh: true, owned: false });
  for (const timestamp of [20, 50, 170, 300]) {
    assert.deepEqual(tracker.sample(timestamp, true), { fresh: false, owned: false });
  }
  assert.deepEqual(tracker.sample(501, true), { fresh: true, owned: true });
  assert.deepEqual(tracker.sample(550, false), { fresh: false, owned: true });
  tracker.reset();
  assert.deepEqual(tracker.sample(551, true), { fresh: true, owned: true });
});

test("native momentum cannot start a captured wheel gesture after a quiet gap", () => {
  const tracker = new WheelSessionTracker(200);
  assert.deepEqual(tracker.sample(0, true, true), { fresh: true, owned: false });
  assert.deepEqual(tracker.sample(20, true, false), { fresh: false, owned: false });
  assert.deepEqual(tracker.sample(250, true, false), { fresh: true, owned: true });
  assert.deepEqual(tracker.sample(270, true, true), { fresh: false, owned: true });
  assert.deepEqual(tracker.sample(900, true, true), { fresh: true, owned: false });
});

test("equivalent normalized wheel traces reach the same bounded navigation target", () => {
  const modes = [
    { deltaMode: 0, deltaY: 16 },
    { deltaMode: 1, deltaY: 1 },
    { deltaMode: 2, deltaY: 0.02 },
  ];
  const distances = modes.map(event => {
    const store = setup();
    const session = store.getState().beginInput("wheel")!;
    for (let i = 0; i < 4; i++) {
      const { y } = normalizeWheelDelta({ deltaX: 0, ...event }, 16, 800);
      store.getState().travelInput(y, session);
      store.getState().advanceNavigation(16, false);
    }
    return store.getState().distanceTarget;
  });
  assert.equal(distances[0], 64);
  assert.deepEqual(distances, [64, 64, 64]);
});

test("every complete showcase route can be selected, traversed and reversed with exact edges", () => {
  const data = showcase as GraphJSON;
  const routes: GraphEdge[][] = [];
  function collect(id: number, prefix: GraphEdge[]) {
    const outgoing = data.edges.filter(edge => edge.from === id);
    if (!outgoing.length) routes.push(prefix);
    for (const edge of outgoing) collect(edge.to, [...prefix, edge]);
  }
  collect(data.root, []);
  assert.equal(routes.length, 17, "Showcase fixture coverage must include every complete route");
  for (const route of routes) {
    const store = setup(); store.getState().loadGraph(structuredClone(data));
    for (const edge of route) store.getState().focusEdge(edge.id);
    assert.deepEqual(store.getState().activeEdges.map(edge => edge.id), route.map(edge => edge.id));
    for (let i = 0; i < route.length + 1 && store.getState().scrollCurrent < route.length; i++) {
      gesture(store, 1_000_000, "pointer");
    }
    assert.equal(store.getState().scrollCurrent, route.length);
    assert.equal(store.getState().activePath[route.length].id, route.at(-1)!.to);
    let remainingStops = route.length + 1;
    while (store.getState().scrollCurrent > 0 && remainingStops-- > 0) {
      const previous = store.getState().scrollCurrent;
      gesture(store, -1_000_000, "pointer");
      assert(store.getState().scrollCurrent < previous, "Reverse makes progress toward an earlier fork/root");
      assert.deepEqual(store.getState().activeEdges.map(edge => edge.id), route.map(edge => edge.id));
    }
    assert.equal(store.getState().scrollCurrent, 0);
  }
});

test("animation uses elapsed time consistently across refresh rates and avoids hidden-tab jumps", () => {
  const positions = [30, 60, 120].map(rate => {
    const store = setup();
    const session = store.getState().beginInput("wheel")!;
    store.getState().travelInput(50, session);
    for (let frame = 0; frame < rate / 10; frame++) store.getState().advanceNavigation(1000 / rate, false);
    return store.getState().distanceCurrent;
  });
  assert(Math.max(...positions) - Math.min(...positions) < 0.05, `Refresh-dependent positions: ${positions}`);
  const store = setup();
  const session = store.getState().beginInput("wheel")!;
  store.getState().travelInput(50, session);
  store.getState().advanceNavigation(60_000, false);
  assert(store.getState().distanceCurrent < 50, "A long pause must not consume unbounded elapsed time");
});

test("editing invalidates in-flight commands and reconciles removal of the selected edge", () => {
  const store = setup();
  store.getState().focusEdge("1-3");
  const session = store.getState().beginInput("wheel")!;
  store.getState().travelInput(150, session);
  store.getState().advanceNavigation(16, false);
  const revision = store.getState().graphRevision;
  store.getState().removeEdge("1-3");
  assert(store.getState().graphRevision > revision);
  assert.equal(store.getState().inputSession, null);
  assert(Number.isFinite(store.getState().distanceCurrent));
  assert(store.getState().scrollCurrent >= 0 && store.getState().scrollCurrent < store.getState().activePath.length);
  assert.equal(store.getState().branchChoices[1], undefined);
  unchanged(store, () => store.getState().travelInput(50, session));
});

test("invalid imported graph cannot partially replace a working graph", () => {
  const store = setup();
  const data = fixture();
  data.edges.push({ id: "cycle", from: 5, to: 0, type: "branch", curve: 0 });
  const before = store.getState();
  assert.throws(() => store.getState().loadGraph(data));
  assert.strictEqual(store.getState(), before);
});

test("invalid geometry on an inactive branch cannot partially publish an import", () => {
  const store = setup();
  const data = fixture();
  data.edges.find(edge => edge.id === "3-8")!.curve = Number.MAX_VALUE;
  const before = store.getState();
  assert.throws(() => store.getState().loadGraph(data));
  assert.strictEqual(store.getState(), before);
});

test("editor permits travel while node selection remains reserved for editing", () => {
  const store = setup();
  store.getState().toggleEditor();
  unchanged(store, () => store.getState().focusEdge("1-3"));
  unchanged(store, () => store.getState().focusNode(3));
  unchanged(store, () => store.getState().setBranchChoice(1, "1-3"));
  store.getState().stepNavigation(1);
  store.getState().advanceNavigation(16, true);
  assert.equal(store.getState().scrollCurrent, 1);
  const session = store.getState().beginInput("wheel")!;
  assert.notEqual(session, null);
  store.getState().travelInput(20, session);
  store.getState().advanceNavigation(16, true);
  assert(store.getState().scrollCurrent > 1);
});

test("nonfinite, zero and stale travel commands do not change the controller", () => {
  const store = setup();
  const session = store.getState().beginInput("wheel")!;
  for (const value of [NaN, Infinity, -Infinity, 0]) {
    unchanged(store, () => store.getState().travelInput(value, session));
  }
  unchanged(store, () => store.getState().travelInput(10, session + 1));
});

test("parallel-edge traversal history retains the exact edge on both sides of a merge", () => {
  const data = fixture();
  data.edges.push({ id: "1-2-alternate", from: 1, to: 2, type: "branch", curve: 80 });
  const store = setup(); store.getState().loadGraph(data);
  store.getState().focusEdge("1-2-alternate");
  store.getState().focusEdge("2-4");
  gesture(store, 100_000);
  gesture(store, -100_000);
  assert.equal(store.getState().activePath[store.getState().scrollCurrent].id, 4);
  assert.deepEqual(store.getState().travelledEdges, ["0-1", "1-2-alternate", "2-4"]);
  gesture(store, -100_000);
  assert.equal(store.getState().activePath[store.getState().scrollCurrent].id, 2);
  assert.deepEqual(store.getState().travelledEdges, ["0-1", "1-2-alternate"]);
});

test("two viewer stores maintain independent session ownership, motion and route intent", () => {
  const first = setup();
  const second = setup();
  const secondBefore = second.getState();
  first.getState().focusEdge("1-3");
  const firstSession = first.getState().beginInput("pointer")!;
  first.getState().travelInput(20, firstSession);
  first.getState().advanceNavigation(16, false);
  assert.strictEqual(second.getState(), secondBefore);
  const firstBefore = first.getState();
  second.getState().focusEdge("1-2");
  const secondSession = second.getState().beginInput("wheel")!;
  second.getState().travelInput(50, secondSession);
  second.getState().advanceNavigation(16, false);
  assert.strictEqual(first.getState(), firstBefore);
  first.getState().cancelInput();
  assert.equal(second.getState().inputSession?.source, "wheel");
  assert.equal(first.getState().branchChoices[1], "1-3");
  assert.equal(second.getState().branchChoices[1], "1-2");
});

test("root and terminal arrival consume residual direction changes until a fresh session", () => {
  const store = setup();
  const rootSession = store.getState().beginInput("wheel")!;
  store.getState().travelInput(-50, rootSession);
  assert.equal(store.getState().inputSession?.blocked, true);
  unchanged(store, () => store.getState().travelInput(50, rootSession));
  assert.equal(store.getState().scrollTarget, 0);
  store.getState().endInput(rootSession);
  store.getState().focusNode(5);
  const arrivalSession = store.getState().beginInput("wheel")!;
  store.getState().travelInput(100_000, arrivalSession);
  settle(store);
  assert.equal(store.getState().activePath[store.getState().scrollCurrent].id, 5);
  assert.equal(store.getState().inputSession?.blocked, true);
  unchanged(store, () => store.getState().travelInput(-50, arrivalSession));
  store.getState().endInput(arrivalSession);
  gesture(store, -100_000);
  assert.equal(store.getState().activePath[store.getState().scrollCurrent].id, 4);
});

test("a fresh backward gesture continues past a fork before its camera settles", () => {
  const store = setup();
  gesture(store, 100_000);
  const first = store.getState().beginInput("pointer")!;
  store.getState().travelInput(-100_000, first);
  assert.equal(store.getState().activePath[store.getState().scrollTarget].id, 4);
  store.getState().advanceNavigation(16, false);
  assert(store.getState().scrollCurrent > store.getState().scrollTarget);
  store.getState().endInput(first);
  const second = store.getState().beginInput("pointer")!;
  store.getState().travelInput(-100_000, second);
  assert.equal(store.getState().activePath[store.getState().scrollTarget].id, 2);
  unchanged(store, () => store.getState().focusEdge("1-3"));
  store.getState().endInput(second);
  settle(store);
  assert.deepEqual(store.getState().branchChoices, {});
  assert.equal(store.getState().activePath[store.getState().scrollCurrent].id, 2);
});

test("isolated small wheel notches make cumulative progress instead of snapping backward", () => {
  const store = setup();
  let previous = 0;
  for (let notch = 0; notch < 5; notch++) {
    gesture(store, 1);
    assert(store.getState().distanceCurrent > previous, "Idle snapping must not undo deliberate forward motion");
    previous = store.getState().distanceCurrent;
  }
});

test("node dragging owns motion only until the drag ends", () => {
  const store = setup();
  const session = store.getState().beginInput("wheel")!;
  store.getState().travelInput(20, session);
  store.getState().advanceNavigation(16, false);
  store.getState().toggleEditor();
  store.getState().setNodeDragActive(true);
  unchanged(store, () => assert.equal(store.getState().beginInput("pointer"), null));
  unchanged(store, () => store.getState().stepNavigation(1));
  unchanged(store, () => store.getState().advanceNavigation(100, false));
  unchanged(store, () => store.getState().advanceNavigation(100, true));
  store.getState().setNodeDragActive(false);
  store.getState().stepNavigation(1);
  store.getState().advanceNavigation(16, true);
  assert.equal(store.getState().scrollCurrent, 1);
});

test("legacy camera setters cannot teleport beyond the authorized motion target", () => {
  const store = setup();
  unchanged(store, () => store.getState().setScrollCurrent(4));
  store.getState().setScrollTarget(1);
  assert.equal(store.getState().scrollTarget, 1);
  unchanged(store, () => store.getState().setScrollCurrent(2));
  store.getState().setScrollCurrent(0.5);
  assert.equal(store.getState().scrollCurrent, 0.5);
  assert.deepEqual(store.getState().travelledEdges, ["0-1"]);
  store.getState().setScrollCurrent(1);
  assert.equal(store.getState().scrollCurrent, 1);
  unchanged(store, () => store.getState().setScrollCurrent(1.01));
});

test("planning beyond a merge preserves a longer explicitly chosen future detour", () => {
  for (const target of ["node", "edge"]) {
    const data = fixture();
    data.edges.push({ id: "9-4", from: 9, to: 4, type: "main", curve: 0 });
    const store = setup(); store.getState().loadGraph(data); restAt(store, 1);
    store.getState().focusEdge("9-4");
    assert.deepEqual(path(store), [0, 1, 3, 8, 9, 4, 5]);
    if (target === "node") store.getState().focusNode(10);
    else store.getState().focusEdge("10-5");
    assert.deepEqual(path(store), [0, 1, 3, 8, 9, 4, 10, 5]);
    assert.equal(store.getState().branchChoices[1], "1-3");
    assert.equal(store.getState().branchChoices[3], "3-8");
    assert.equal(store.getState().scrollCurrent, 1);
  }
});

test("an implicit SVG capture transfer does not cancel the wrapper's active drag", () => {
  assert.equal(shouldCancelPointerCapture(7, 7, false, true), false);
  assert.equal(shouldCancelPointerCapture(7, 7, false, false), false);
  assert.equal(shouldCancelPointerCapture(7, 7, true, true), false);
  assert.equal(shouldCancelPointerCapture(7, 8, true, false), false);
  assert.equal(shouldCancelPointerCapture(undefined, 7, true, false), false);
  assert.equal(shouldCancelPointerCapture(7, 7, true, false), true);
});

test("the short reverse pause uses one deadline and incoming tails cannot extend it", () => {
  const pause = new WheelReversePause(90);
  assert.equal(pause.ready(1000), false);
  pause.start(100);
  assert.equal(pause.ready(189), false);
  for (const now of [120, 150, 170, 189]) pause.start(now);
  assert.equal(pause.ready(190), true);
  pause.reset();
  assert.equal(pause.ready(1000), false);
});

test("fresh reverse wheel intent bypasses a pause but continuous or native momentum does not", () => {
  assert.equal(isFreshReverseWheelIntent(16, undefined, undefined), false);
  assert.equal(isFreshReverseWheelIntent(39, false, false), false);
  assert.equal(isFreshReverseWheelIntent(40, undefined, undefined), true);
  assert.equal(isFreshReverseWheelIntent(40, true, false), false);
  assert.equal(isFreshReverseWheelIntent(1, false, true), true);
});

test("recommended branch persists through JSON roundtrip without becoming an explicit user choice", () => {
  const store = setup();
  store.getState().updateNode(1, { recommendedEdgeId: "1-3" });
  assert.equal(store.getState().activeEdges[1].id, "1-3");
  assert.deepEqual(store.getState().branchChoices, {});
  const restored = setup();
  restored.getState().loadGraph(JSON.parse(JSON.stringify(store.getState().toJSON())));
  assert.equal(restored.getState().graph.nodes[1].recommendedEdgeId, "1-3");
  assert.equal(restored.getState().activeEdges[1].id, "1-3");
  gesture(restored, 100_000);
  assert(restored.getState().travelledEdges.includes("1-3"));
});

test("explicit route selection overrides a recommendation without rewriting authored metadata", () => {
  const store = setup();
  store.getState().updateNode(1, { recommendedEdgeId: "1-3" });
  store.getState().focusEdge("1-2");
  gesture(store, 100_000);
  assert.equal(store.getState().branchChoices[1], "1-2");
  assert.equal(store.getState().graph.nodes[1].recommendedEdgeId, "1-3");
  assert(store.getState().travelledEdges.includes("1-2"));
});

test("deleting a recommended edge or target clears the inherited recommendation and exports valid JSON", () => {
  for (const remove of ["edge", "node"]) {
    const store = setup();
    store.getState().updateNode(1, { recommendedEdgeId: "1-3" });
    if (remove === "edge") store.getState().removeEdge("1-3");
    else store.getState().removeNode(3);
    assert.equal(store.getState().graph.nodes[1].recommendedEdgeId, undefined);
    const restored = setup();
    assert.doesNotThrow(() => restored.getState().loadGraph(JSON.parse(JSON.stringify(store.getState().toJSON()))));
    assert(!restored.getState().graph.edges.some(edge => edge.id === "1-3"));
  }
});

test("an invalid newly authored recommendation cannot partially publish graph changes", () => {
  const store = setup();
  const graph = store.getState().graph;
  const pathBefore = path(store);
  store.getState().updateNode(1, { recommendedEdgeId: "3-8" });
  assert.strictEqual(store.getState().graph, graph);
  assert.deepEqual(path(store), pathBefore);
  assert.equal(store.getState().graph.nodes[1].recommendedEdgeId, undefined);
  assert(store.getState().graphError);
});
