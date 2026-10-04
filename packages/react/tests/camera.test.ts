import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "zustand/vanilla";
import { createThreadriftStore } from "../src/store/threadrift-store";
import { resolveCamera } from "../src/store/camera-state";
import { edgeBounds, overlaps, viewBounds } from "../src/components/viewport";
import { parseGraphDocument, type GraphJSON } from "@threadrift/core";

function fixture(): GraphJSON {
  return { version: "4.0", root: 0, nextNodeId: 3, nodes: {
    0: { id: 0, name: "Root", content: "", x: 100, y: 100 },
    1: { id: 1, name: "Next", content: "", x: 100, y: 400 },
    2: { id: 2, name: "End", content: "", x: 300, y: 700 },
  }, edges: [{ id: "a", from: 0, to: 1, type: "main", curve: .7 }, { id: "b", from: 1, to: 2, type: "main", curve: -.4 }], settings: { editor: { autoSaveEnabled: false } } };
}
function setup() {
  const store = createStore(createThreadriftStore);
  store.getState().configurePersistence(false); store.getState().loadGraph(fixture()); store.getState().toggleEditor();
  return store;
}
test("freeze captures the resolved mid-motion view and blocks all graph travel", () => {
  const s = setup(); s.getState().setScrollTarget(1); s.getState().advanceNavigation(16, false);
  const before = resolveCamera(s.getState()), progress = s.getState().scrollCurrent;
  s.getState().setCameraMode("freeze");
  assert.deepEqual(resolveCamera(s.getState()), before);
  s.getState().setScrollTarget(2); s.getState().stepNavigation(1); s.getState().advanceNavigation(64, true);
  assert.equal(s.getState().beginInput("wheel"), null);
  assert.equal(s.getState().scrollCurrent, progress); assert.deepEqual(resolveCamera(s.getState()), before);
});
test("drag preview is excluded from export/save; one commit saves the node and view together", async () => {
  const s = setup(); const writes: any[] = [];
  s.getState().configurePersistence({ storage: null, adapter: { load: async () => ({ document: fixture(), revision: null }), save: async document => { writes.push(document); return { revision: "r" }; } } });
  s.getState().setCameraMode("freeze"); const initial = s.getState().toJSON();
  const token = s.getState().beginNodeEdit(0)!;
  for (const x of [150, 170, 210]) s.getState().previewNodePosition(token, { x, y: 150 });
  assert.deepEqual(resolveCamera(s.getState()), { x: 100, y: 100 });
  assert.equal(s.getState().graph.nodes[0].x, 210); assert.deepEqual(s.getState().toJSON(), initial);
  await s.getState().saveGraph(); assert.deepEqual(writes[0], initial);
  const revision = s.getState().documentRevision;
  s.getState().finishNodeEdit(token, true); s.getState().finishNodeEdit(token, true);
  assert.equal(s.getState().documentRevision, revision + 1);
  await s.getState().saveGraph(); assert.equal(writes[1].nodes[0].x, 210); assert.deepEqual(writes[1].nodes[0].camera, { x: 100, y: 100 });
  const restored = createStore(createThreadriftStore); restored.getState().loadGraph(writes[1]);
  assert.deepEqual(resolveCamera(restored.getState()), { x: 100, y: 100 });
});
test("cancellation, no-op moves and invalid geometry do not create saved views", () => {
  const s = setup(); s.getState().setCameraMode("freeze"); const original = s.getState().toJSON();
  let token = s.getState().beginNodeEdit(0)!;
  s.getState().previewNodePosition(token, { x: 200, y: 100 }); s.getState().finishNodeEdit(token, false);
  assert.deepEqual(s.getState().toJSON(), original); assert.equal(s.getState().isDirty, false);
  token = s.getState().beginNodeEdit(0)!; s.getState().previewNodePosition(token, { x: 100, y: 400 });
  assert.match(s.getState().graphError!, /zero-length/); s.getState().finishNodeEdit(token, true);
  assert.deepEqual(s.getState().toJSON(), original);
  token = s.getState().beginNodeEdit(0)!; s.getState().previewNodePosition(token, { x: 110, y: 100 });
  s.getState().previewNodePosition(token, { x: 100, y: 100 }); s.getState().finishNodeEdit(token, true);
  assert.deepEqual(s.getState().toJSON(), original); assert.equal(s.getState().isDirty, false);
});
test("external edits/import/delete invalidate the transaction without restoring stale state", () => {
  const s = setup(); const token = s.getState().beginNodeEdit(1)!;
  s.getState().previewNodePosition(token, { x: 200, y: 400 }); s.getState().updateNode(1, { name: "New name" });
  s.getState().finishNodeEdit(token, false);
  assert.equal(s.getState().graph.nodes[1].name, "New name"); assert.equal(s.getState().graph.nodes[1].x, 100);
  const token2 = s.getState().beginNodeEdit(1)!; s.getState().previewNodePosition(token2, { x: 200, y: 400 });
  s.getState().removeNode(1); s.getState().finishNodeEdit(token2, true); assert.equal(s.getState().graph.nodes[1], undefined);
  s.getState().loadGraph(fixture()); s.getState().setCameraMode("freeze");
  const token3 = s.getState().beginNodeEdit(0)!; s.getState().previewNodePosition(token3, { x: 200, y: 100 });
  const replacement = fixture(); replacement.nodes[0].name = "Imported";
  s.getState().loadGraph(replacement); s.getState().finishNodeEdit(token3, true);
  assert.equal(s.getState().graph.nodes[0].name, "Imported"); assert.equal(s.getState().cameraOverride, null);
});
test("saved views stay fixed during ordinary moves and metadata edits preserve navigation progress", () => {
  const s = setup(); s.getState().setScrollTarget(1); s.getState().advanceNavigation(20, false);
  const before = s.getState().scrollCurrent;
  s.getState().setNodeCamera(0, { x: -100, y: 50 }); s.getState().setEdgeCamera("a", { mode: "direct", start: .2, end: .9 });
  assert.equal(s.getState().scrollCurrent, before);
  s.getState().updateNode(0, { x: 120 }); assert.deepEqual(s.getState().graph.nodes[0].camera, { x: -100, y: 50 });
  s.getState().setNodeCamera(0, undefined); assert.equal(Object.hasOwn(s.getState().toJSON().nodes[0], "camera"), false);
});
test("editing another node captures only that node and resuming never changes route history", () => {
  const s = setup(); s.getState().setCameraMode("freeze");
  const token = s.getState().beginNodeEdit(2)!; s.getState().previewNodePosition(token, { x: 450, y: 710 }); s.getState().finishNodeEdit(token, true);
  assert.equal(s.getState().graph.nodes[0].camera, undefined); assert.deepEqual(s.getState().graph.nodes[2].camera, { x: 100, y: 100 });
  s.getState().setCameraMode("position"); s.getState().moveCameraPreview({ x: 800, y: 900 });
  const visits = [...s.getState().visitedNodes], choices = s.getState().branchChoices;
  s.getState().setCameraMode("follow"); assert.deepEqual(resolveCamera(s.getState()), { x: 800, y: 900 });
  for (let i = 0; i < 4; i++) s.getState().advanceNavigation(64, false);
  assert.equal(s.getState().cameraReturn, null); assert.deepEqual(resolveCamera(s.getState()), { x: 100, y: 100 });
  assert.deepEqual([...s.getState().visitedNodes], visits); assert.deepEqual(s.getState().branchChoices, choices);
});
test("preview/capture/reset are isolated across providers and reduced motion returns immediately", () => {
  const a = setup(), b = setup(); a.getState().setCameraMode("position"); a.getState().moveCameraPreview({ x: -25, y: 700 });
  a.getState().captureNodeCamera(1); assert.deepEqual(a.getState().graph.nodes[1].camera, { x: -25, y: 700 });
  assert.equal(b.getState().graph.nodes[1].camera, undefined); assert.equal(b.getState().cameraMode, "follow");
  a.getState().setCameraMode("follow"); a.getState().advanceNavigation(1, true); assert.equal(a.getState().cameraReturn, null);
  a.getState().previewNodeCamera(1); a.getState().toggleEditor(); a.getState().advanceNavigation(1, true);
  assert.equal(a.getState().cameraMode, "follow"); assert.equal(a.getState().cameraOverride, null);
});
test("viewport bounds follow custom centers and include crossing curves without visible endpoints", () => {
  const s = setup(); const g = s.getState().graph, sequences = s.getState().sequences;
  const bounds = edgeBounds(g, sequences).get("a")!;
  const view = viewBounds({ x: 100, y: 250 }, 20, 1000);
  assert(overlaps(bounds, view));
  assert.equal(overlaps(bounds, viewBounds({ x: 9000, y: 9000 }, 1000, 1000)), false);
  assert.equal(parseGraphDocument(s.getState().toJSON()).version, "4.0");
});

test("an active save and recovery draft never observe a half-finished camera drag", async () => {
  const s = setup(), writes: any[] = [], gates: (() => void)[] = [], values = new Map<string, string>();
  s.getState().configurePersistence({ debounceMs: 1, storageKey: "camera-test", storage: {
    getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); },
  }, adapter: { load: async () => ({ document: fixture(), revision: null }), save: async doc => {
    writes.push(doc); await new Promise<void>(resolve => gates.push(resolve)); return { revision: `r${writes.length}` };
  } } });
  s.getState().updateNode(0, { name: "Committed before drag" });
  const saving = s.getState().saveGraph();
  s.getState().setCameraMode("freeze"); const token = s.getState().beginNodeEdit(0)!;
  s.getState().previewNodePosition(token, { x: 140, y: 130 });
  // A settings edit during the drag can create a draft, but only of committed graph data.
  s.getState().updatePhysics({ snapStrength: .3 });
  let draft = JSON.parse(values.get("camera-test")!).document;
  assert.equal(draft.nodes[0].x, 100); assert.equal(draft.nodes[0].camera, undefined);
  s.getState().finishNodeEdit(token, true);
  draft = JSON.parse(values.get("camera-test")!).document;
  assert.equal(draft.nodes[0].x, 140); assert.deepEqual(draft.nodes[0].camera, { x: 100, y: 100 });
  gates[0](); await saving;
  assert.equal(s.getState().isDirty, true);
  const second = s.getState().saveGraph();
  assert.equal(writes[1].nodes[0].x, 140); assert.deepEqual(writes[1].nodes[0].camera, { x: 100, y: 100 });
  gates[1](); await second; assert.equal(s.getState().isDirty, false);
});

test("reload started before a drag cannot replace its preview or commit", async () => {
  const s = setup(); let complete!: (value: any) => void;
  s.getState().configurePersistence({ storage: null, adapter: { load: () => new Promise(resolve => { complete = resolve; }), save: async () => ({ revision: null }) } });
  const loading = s.getState().reloadGraph(); const token = s.getState().beginNodeEdit(1)!;
  s.getState().previewNodePosition(token, { x: 170, y: 450 });
  complete({ document: fixture(), revision: "r" }); assert.equal(await loading, false);
  assert.equal(s.getState().graph.nodes[1].x, 170);
  assert.equal(await s.getState().reloadGraph(), false);
  s.getState().finishNodeEdit(token, true); assert.equal(s.getState().toJSON().nodes[1].x, 170);
});

test("camera APIs detach caller data, reject unsafe descriptors and preserve the last valid document", () => {
  const s = setup(), camera = { x: 0, y: -20 }, schedule = { mode: "direct" as const, start: .1, end: .9 };
  s.getState().setNodeCamera(0, camera); s.getState().setEdgeCamera("a", schedule);
  camera.x = 1000; schedule.start = .3;
  const before = s.getState().toJSON();
  assert.equal(before.nodes[0].camera!.x, 0); assert.equal(before.edges[0].camera!.start, .1);
  const unsafe = Object.defineProperty({ y: 0 }, "x", { enumerable: true, get() { throw new Error("Must not execute"); } });
  assert.doesNotThrow(() => s.getState().setNodeCamera(0, unsafe as any));
  s.getState().setNodeCamera(0, { x: 0, y: NaN }); s.getState().setEdgeCamera("a", { mode: "path", start: .9, end: .1 });
  assert.deepEqual(s.getState().toJSON(), before);
});
