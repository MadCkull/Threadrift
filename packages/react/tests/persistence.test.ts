import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "zustand/vanilla";
import type { GraphJSON } from "@threadrift/core";
import { createThreadriftStore } from "../src/store/threadrift-store";
import type { PersistenceAdapter } from "../src/persistence/types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function until(predicate: () => boolean, message: string) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail(message);
}
function controlledAdapter() {
  const writes: { document: any; revision: string | null; gate: ReturnType<typeof deferred<{ revision: string | null }>> }[] = [];
  const reads: ReturnType<typeof deferred<{ document: unknown; revision: string | null }>>[] = [];
  const adapter: PersistenceAdapter = {
    load: async () => { const gate = deferred<{ document: unknown; revision: string | null }>(); reads.push(gate); return gate.promise; },
    save: async (document, revision) => { const gate = deferred<{ revision: string | null }>(); writes.push({ document, revision, gate }); return gate.promise; },
  };
  return { writes, reads, adapter };
}

function fixture(): GraphJSON {
  return { version: "2.0", root: 0, nextNodeId: 4,
    nodes: {
      "0": { id: 0, name: "Start", content: "Intro", x: 100, y: 100 },
      "1": { id: 1, name: "Fork", content: "Choose", x: 100, y: 300 },
      "2": { id: 2, name: "Left", content: "", x: 20, y: 550 },
      "3": { id: 3, name: "Right", content: "", x: 300, y: 550 },
    }, edges: [
      { id: "start", from: 0, to: 1, type: "main", curve: 0 },
      { id: "left", from: 1, to: 2, type: "main", curve: 0 },
      { id: "right", from: 1, to: 3, type: "branch", curve: 0.2 },
    ], settings: { physics: { scrollSensitivity: .0012, touchSensitivity: .003, snapStrength: .18, snapThreshold: .25 }, editor: { autoSaveEnabled: false } } };
}

function setup() {
  const store = createStore(createThreadriftStore);
  store.getState().loadGraph(fixture());
  return store;
}

test("every authored node, edge, recommendation and physics field survives document roundtrip", () => {
  const store = setup();
  store.getState().updateNode(1, { name: "A renamed fork 🎯", content: "Paragraph\nsecond line", x: 150, y: 320,
    anchorX: -45, anchorY: 62, anchorWidth: 435, recommendedEdgeId: "right", extensions: { app: { flags: [true, null, "v"] } } });
  store.getState().updateEdge("right", { curve: -.25, curveEnd: .45, diverge: .65, extensions: { app: { label: "optional" } } });
  store.getState().updatePhysics({ scrollSensitivity: .0021, touchSensitivity: .0042, snapStrength: .27, snapThreshold: .34 });
  const document = store.getState().toJSON();
  const restored = createStore(createThreadriftStore);
  restored.getState().loadGraph(JSON.parse(JSON.stringify(document)));
  assert.deepEqual(restored.getState().toJSON(), document);
  assert.deepEqual(restored.getState().physics, { scrollSensitivity: .0021, touchSensitivity: .0042, snapStrength: .27, snapThreshold: .34 });
  assert.equal(restored.getState().graph.nodes[1].recommendedEdgeId, "right");
  assert.equal(restored.getState().autoSaveEnabled, false);
  for (const node of Object.values(document.nodes)) for (const field of ["level", "seqId", "parentSeqId", "vx", "vy"]) {
    assert.equal(Object.hasOwn(node, field), false, `${field} is derived runtime data`);
  }
  for (const field of ["branchChoices", "scrollCurrent", "visitedNodes", "selectedNode", "editorOpen", "saveStatus"]) {
    assert.equal(Object.hasOwn(document, field), false, `${field} is session state`);
  }
});

test("deleting a recommended edge serializes removal, and node creation/deletion retains the ID allocator", () => {
  const store = setup();
  store.getState().updateNode(1, { recommendedEdgeId: "right" });
  store.getState().removeEdge("right");
  assert.equal(store.getState().toJSON().nodes[1].recommendedEdgeId, undefined);
  const created = store.getState().addNode(2, "main");
  assert(created);
  const allocated = store.getState().nextNodeId;
  store.getState().removeNode(created.id);
  const restored = createStore(createThreadriftStore);
  restored.getState().loadGraph(store.getState().toJSON());
  assert.equal(restored.getState().nextNodeId, allocated);
  assert.equal(restored.getState().graph.nodes[created.id], undefined);
  assert((restored.getState().addNode(2, "main")?.id ?? -1) >= allocated);
});

test("invalid imports preserve the complete live document and dirty state atomically", () => {
  const store = setup();
  store.getState().updateNode(0, { name: "Unsaved valid edit" });
  const before = store.getState();
  const invalid = fixture();
  invalid.nodes[1].recommendedEdgeId = "missing";
  assert.throws(() => store.getState().loadGraph(invalid, { source: "import" }));
  assert.strictEqual(store.getState(), before);
});

test("navigation, selection and editor visibility do not create authored document edits", () => {
  const store = setup();
  const original = store.getState().toJSON();
  store.getState().selectNode(1);
  store.getState().selectEdge("right");
  store.getState().markVisited(2);
  store.getState().stepNavigation(1);
  store.getState().advanceNavigation(16, true);
  store.getState().focusEdge("right");
  store.getState().toggleEditor();
  assert.deepEqual(store.getState().toJSON(), original);
  assert.equal(store.getState().isDirty, false);
});

test("rapid edits serialize immutable snapshots without overlapping writes or stale clean status", async () => {
  const store = setup(); const io = controlledAdapter();
  store.getState().configurePersistence({ adapter: io.adapter, storage: null, debounceMs: 5 });
  store.getState().updateNode(0, { name: "First snapshot" });
  const first = store.getState().saveGraph();
  await until(() => io.writes.length === 1, "first write starts");
  store.getState().updateNode(0, { name: "Second snapshot" });
  const second = store.getState().saveGraph();
  store.getState().updateNode(0, { content: "Latest edit" });
  const third = store.getState().saveGraph();
  assert.equal(io.writes.length, 1, "only one request may be in flight");
  assert.equal(io.writes[0].document.nodes[0].name, "First snapshot");
  io.writes[0].gate.resolve({ revision: '"r1"' });
  await until(() => io.writes.length === 2, "queued latest snapshot starts");
  assert.equal(store.getState().isDirty, true, "old acknowledgement must not clean newer edits");
  assert.equal(io.writes[1].revision, '"r1"', "queued save uses preceding committed revision");
  assert.equal(io.writes[1].document.nodes[0].name, "Second snapshot");
  assert.equal(io.writes[1].document.nodes[0].content, "Latest edit");
  io.writes[1].gate.resolve({ revision: '"r2"' });
  await Promise.all([first, second, third]);
  assert.equal(io.writes.length, 2);
  assert.equal(store.getState().isDirty, false);
  assert.equal(store.getState().saveStatus, "saved");
});

test("failed writes retain dirty data and a manual retry persists the latest document", async () => {
  const store = setup(); const io = controlledAdapter();
  store.getState().configurePersistence({ adapter: io.adapter, storage: null });
  store.getState().updateNode(0, { name: "Keep this" });
  const failed = store.getState().saveGraph();
  await until(() => io.writes.length === 1, "write starts");
  io.writes[0].gate.reject(new Error("Disk unavailable"));
  assert.equal(await failed, false);
  assert.equal(store.getState().isDirty, true);
  assert.equal(store.getState().saveStatus, "error");
  assert.match(store.getState().saveError ?? "", /Disk unavailable/);
  store.getState().updateNode(0, { content: "Added during recovery" });
  const retry = store.getState().saveGraph();
  await until(() => io.writes.length === 2, "retry starts");
  assert.equal(io.writes[1].document.nodes[0].content, "Added during recovery");
  io.writes[1].gate.resolve({ revision: '"ok"' });
  assert.equal(await retry, true);
  assert.equal(store.getState().isDirty, false);
  assert.equal(store.getState().saveError, null);
});

test("two providers have independent debounce queues and settings-only edits autosave", async () => {
  const a = setup(), b = setup(), one = controlledAdapter(), two = controlledAdapter();
  a.getState().configurePersistence({ adapter: one.adapter, storage: null, debounceMs: 5 });
  b.getState().configurePersistence({ adapter: two.adapter, storage: null, debounceMs: 5 });
  a.getState().setAutoSaveEnabled(true); b.getState().setAutoSaveEnabled(true);
  a.getState().updatePhysics({ touchSensitivity: .005 });
  b.getState().updatePhysics({ snapThreshold: .4 });
  await until(() => one.writes.length === 1 && two.writes.length === 1, "both providers independently autosave");
  assert.equal(one.writes[0].document.settings.physics.touchSensitivity, .005);
  assert.equal(two.writes[0].document.settings.physics.snapThreshold, .4);
  one.writes[0].gate.resolve({ revision: "a1" }); two.writes[0].gate.resolve({ revision: "b1" });
  await until(() => !a.getState().isDirty && !b.getState().isDirty, "both saves finish");
});

test("disabling autosave cancels pending work and manual save persists the disabled policy", async () => {
  const store = setup(); const io = controlledAdapter();
  store.getState().configurePersistence({ adapter: io.adapter, storage: null, debounceMs: 10 });
  store.getState().setAutoSaveEnabled(true);
  store.getState().updateNode(0, { name: "Pending edit" });
  store.getState().setAutoSaveEnabled(false);
  await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal(io.writes.length, 0);
  assert.equal(store.getState().isDirty, true);
  const saving = store.getState().saveGraph();
  await until(() => io.writes.length === 1, "manual save starts");
  assert.equal(io.writes[0].document.settings.editor.autoSaveEnabled, false);
  io.writes[0].gate.resolve({ revision: "disabled" });
  assert.equal(await saving, true);
});

test("reload refuses dirty documents and a late read cannot overwrite a newer edit", async () => {
  const store = setup(); const io = controlledAdapter();
  store.getState().configurePersistence({ adapter: io.adapter, storage: null });
  const loading = store.getState().reloadGraph();
  await until(() => io.reads.length === 1, "reload starts");
  store.getState().updateNode(0, { name: "Edit while GET is pending" });
  const remote = fixture(); remote.nodes[0].name = "Old disk snapshot";
  io.reads[0].resolve({ document: remote, revision: "old" });
  assert.equal(await loading, false);
  assert.equal(store.getState().graph.nodes[0].name, "Edit while GET is pending");
  assert.equal(await store.getState().reloadGraph(), false);
  assert.equal(io.reads.length, 1, "dirty reload must not start another request");
});

test("import is a dirty authored change and supersedes a pending reload", async () => {
  const store = setup(); const io = controlledAdapter();
  store.getState().configurePersistence({ adapter: io.adapter, storage: null, debounceMs: 5 });
  const loading = store.getState().reloadGraph();
  await until(() => io.reads.length === 1, "read begins");
  const imported = fixture(); imported.nodes[0].name = "Imported graph";
  imported.settings!.editor!.autoSaveEnabled = true;
  store.getState().importGraph(imported);
  assert.equal(store.getState().isDirty, true);
  io.reads[0].resolve({ document: fixture(), revision: "stale" });
  assert.equal(await loading, false);
  assert.equal(store.getState().graph.nodes[0].name, "Imported graph");
  await until(() => io.writes.length === 1, "import autosaves");
  assert.equal(io.writes[0].document.nodes[0].name, "Imported graph");
  io.writes[0].gate.resolve({ revision: "imported" });
  await until(() => !store.getState().isDirty, "import save completes");
});

test("an acknowledged older write cannot clear a replacement document", async () => {
  const store = setup(); const io = controlledAdapter();
  store.getState().configurePersistence({ adapter: io.adapter, storage: null });
  store.getState().updateNode(0, { name: "Before replacement" });
  const saving = store.getState().saveGraph();
  await until(() => io.writes.length === 1, "write starts");
  const replacement = fixture(); replacement.nodes[0].name = "Replacement";
  store.getState().loadGraph(replacement, { revision: "replacement" });
  io.writes[0].gate.resolve({ revision: "old-write" });
  assert.equal(await saving, false);
  assert.equal(store.getState().graph.nodes[0].name, "Replacement");
  assert.equal(store.getState().isDirty, true);
});

test("export is detached from nested extension objects supplied during import", () => {
  const store = setup(); const document = fixture();
  document.extensions = { plugin: { nested: ["original"] } };
  document.nodes[0].extensions = { plugin: { text: "original" } };
  document.settings!.extensions = { plugin: { enabled: true } };
  store.getState().loadGraph(document);
  const saved = store.getState().toJSON();
  (document.extensions.plugin as any).nested[0] = "changed externally";
  (saved.nodes[0].extensions!.plugin as any).text = "changed export";
  assert.deepEqual(store.getState().toJSON().extensions, { plugin: { nested: ["original"] } });
  assert.deepEqual(store.getState().toJSON().nodes[0].extensions, { plugin: { text: "original" } });
  assert.deepEqual(store.getState().toJSON().settings?.extensions, { plugin: { enabled: true } });
});

test("accepted edit patches do not retain caller-owned mutable extension objects", () => {
  const store = setup();
  const nodeExtensions = { plugin: { label: "Authored node" } };
  const edgeExtensions = { plugin: { labels: ["Authored edge"] } };
  store.getState().updateNode(1, { extensions: nodeExtensions });
  store.getState().updateEdge("right", { extensions: edgeExtensions });
  nodeExtensions.plugin.label = "External mutation";
  edgeExtensions.plugin.labels[0] = "External mutation";
  assert.equal((store.getState().toJSON().nodes[1].extensions!.plugin as any).label, "Authored node");
  assert.deepEqual((store.getState().toJSON().edges.find(edge => edge.id === "right")!.extensions!.plugin as any).labels, ["Authored edge"]);
});

test("an unserializable extension edit cannot poison the live document", () => {
  const store = setup();
  const original = store.getState().toJSON();
  store.getState().updateNode(1, { extensions: { plugin: { value: NaN } } });
  assert.deepEqual(store.getState().toJSON(), original);
  assert.match(store.getState().graphError ?? "", /finite|JSON|extension/i);
  store.getState().updateEdge("right", { extensions: { plugin: undefined } } as any);
  assert.deepEqual(store.getState().toJSON(), original);
});

function memoryStorage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

test("reload cannot replace or re-save an older disk copy during an active write", async () => {
  const storage = memoryStorage(), io = controlledAdapter(), store = setup();
  store.getState().configurePersistence({ adapter: io.adapter, storage, storageKey: "race" });
  store.getState().updateNode(0, { name: "Edit A" });
  const saving = store.getState().saveGraph();
  assert.equal(await store.getState().reloadGraph({ preserveDraft: true }), false);
  assert.equal(io.reads.length, 0);
  assert.equal(JSON.parse(storage.getItem("race")!).document.nodes[0].name, "Edit A");
  io.writes[0].gate.resolve({ revision: "saved-a" });
  assert.equal(await saving, true);
  assert.equal(io.writes.length, 1);
  assert.equal(store.getState().graph.nodes[0].name, "Edit A");
});

for (const finishSaveFirst of [false, true]) test(`reload rejects a stale read when a save starts during GET (write finished: ${finishSaveFirst})`, async () => {
  const storage = memoryStorage(), io = controlledAdapter(), store = setup();
  store.getState().configurePersistence({ adapter: io.adapter, storage, storageKey: "read-race" });
  store.getState().updateNode(0, { name: "Edit A" });
  const loading = store.getState().reloadGraph({ preserveDraft: true });
  const saving = store.getState().saveGraph();
  if (finishSaveFirst) { io.writes[0].gate.resolve({ revision: "saved-a" }); await saving; }
  io.reads[0].resolve({ document: fixture(), revision: "old" });
  assert.equal(await loading, false);
  assert.equal(store.getState().graph.nodes[0].name, "Edit A");
  if (!finishSaveFirst) { io.writes[0].gate.resolve({ revision: "saved-a" }); await saving; }
  assert.equal(io.writes.length, 1);
  assert.equal(store.getState().isDirty, false);
});

test("local draft recovers an unsaved document with its saved physics after reopening", async () => {
  const storage = memoryStorage(); const io = controlledAdapter(); const first = setup();
  first.getState().configurePersistence({ adapter: io.adapter, storage, storageKey: "graph-a" });
  first.getState().loadGraph(fixture(), { revision: "disk-one" });
  first.getState().updatePhysics({ touchSensitivity: .006 });
  first.getState().updateNode(0, { content: "Recovered content" });
  assert.equal(storage.values.size, 1);
  const reopened = createStore(createThreadriftStore);
  reopened.getState().configurePersistence({ adapter: io.adapter, storage, storageKey: "graph-a" });
  const loading = reopened.getState().reloadGraph();
  await until(() => io.reads.length === 1, "load starts");
  io.reads[0].resolve({ document: fixture(), revision: "disk-one" });
  assert.equal(await loading, true);
  assert.equal(reopened.getState().graph.nodes[0].content, "Recovered content");
  assert.equal(reopened.getState().physics.touchSensitivity, .006);
  assert.equal(reopened.getState().isDirty, true);
});

test("a draft based on an older disk revision requires explicit recovery", async () => {
  const storage = memoryStorage(); const io = controlledAdapter(); const original = setup();
  original.getState().configurePersistence({ adapter: io.adapter, storage, storageKey: "graph-a" });
  original.getState().loadGraph(fixture(), { revision: "old" });
  original.getState().updateNode(0, { name: "Old local draft" });
  const reopened = createStore(createThreadriftStore);
  reopened.getState().configurePersistence({ adapter: io.adapter, storage, storageKey: "graph-a" });
  const loading = reopened.getState().reloadGraph();
  await until(() => io.reads.length === 1, "load starts");
  const latest = fixture(); latest.nodes[0].name = "New disk edit";
  io.reads[0].resolve({ document: latest, revision: "new" }); await loading;
  assert.equal(reopened.getState().graph.nodes[0].name, "New disk edit");
  assert.equal(reopened.getState().hasRecoveryDraft, true);
  assert.equal(reopened.getState().isDirty, false);
  reopened.getState().restoreDraft();
  assert.equal(reopened.getState().graph.nodes[0].name, "Old local draft");
  assert.equal(reopened.getState().isDirty, true);
  assert.equal(reopened.getState().hasRecoveryDraft, false);
});

test("loading a disk copy preserves dirty edits as an explicitly restorable draft", async () => {
  const storage = memoryStorage(), io = controlledAdapter(), store = setup();
  store.getState().configurePersistence({ adapter: io.adapter, storage, storageKey: "keep-draft" });
  store.getState().loadGraph(fixture(), { revision: "old" });
  store.getState().updateNode(0, { name: "Keep local work" });
  const loading = store.getState().reloadGraph({ preserveDraft: true });
  await until(() => io.reads.length === 1, "explicit disk reload starts");
  const latest = fixture(); latest.nodes[0].name = "Newer disk document";
  io.reads[0].resolve({ document: latest, revision: "new" });
  assert.equal(await loading, true);
  assert.equal(store.getState().graph.nodes[0].name, "Newer disk document");
  assert.equal(store.getState().hasRecoveryDraft, true);
  assert.equal(store.getState().isDirty, false);
  store.getState().restoreDraft();
  assert.equal(store.getState().graph.nodes[0].name, "Keep local work");
  assert.equal(store.getState().isDirty, true);
});

test("loading a disk copy cannot discard edits when its recovery draft cannot be stored", async () => {
  const io = controlledAdapter(), store = setup();
  store.getState().configurePersistence({ adapter: io.adapter, storage: null });
  store.getState().updateNode(0, { name: "Only in memory" });
  assert.equal(await store.getState().reloadGraph({ preserveDraft: true }), false);
  assert.equal(io.reads.length, 0);
  assert.equal(store.getState().graph.nodes[0].name, "Only in memory");
  assert.equal(store.getState().isDirty, true);
});

test("an older recovery draft is insufficient when backing up the newest edits fails", async () => {
  const memory = memoryStorage(), io = controlledAdapter(), store = setup();
  let quotaFull = false;
  store.getState().configurePersistence({ adapter: io.adapter, storage: { ...memory,
    setItem(key, value) { if (quotaFull) throw new Error("Quota full"); memory.setItem(key, value); } }, storageKey: "quota" });
  store.getState().updateNode(0, { name: "Older successfully backed up edit" });
  quotaFull = true;
  store.getState().updateNode(0, { name: "Newest edit cannot be backed up" });
  const loading = store.getState().reloadGraph({ preserveDraft: true });
  // Settle a mistakenly dispatched load so a regression fails rather than hanging the runner.
  if (io.reads.length) io.reads[0].resolve({ document: fixture(), revision: "disk" });
  assert.equal(await loading, false);
  assert.equal(io.reads.length, 0);
  assert.equal(store.getState().graph.nodes[0].name, "Newest edit cannot be backed up");
});

test("offline draft recovery preserves its original revision precondition", async () => {
  const storage = memoryStorage(); const io = controlledAdapter(); const original = setup();
  original.getState().configurePersistence({ adapter: io.adapter, storage, storageKey: "offline" });
  original.getState().loadGraph(fixture(), { revision: "draft-base" });
  original.getState().updateNode(0, { name: "Offline draft" });
  const reopened = createStore(createThreadriftStore);
  reopened.getState().configurePersistence({ adapter: io.adapter, storage, storageKey: "offline" });
  const loading = reopened.getState().reloadGraph();
  await until(() => io.reads.length === 1, "load starts");
  io.reads[0].reject(new Error("Network offline"));
  assert.equal(await loading, true);
  assert.equal(reopened.getState().graph.nodes[0].name, "Offline draft");
  const saving = reopened.getState().saveGraph();
  await until(() => io.writes.length === 1, "recovery save starts");
  assert.equal(io.writes[0].revision, "draft-base");
  io.writes[0].gate.reject(new Error("Conflict"));
  assert.equal(await saving, false);
  assert.equal(reopened.getState().isDirty, true);
  assert.equal(storage.values.size, 1);
});

test("a successful save cannot delete another provider's newer recovery draft", async () => {
  const storage = memoryStorage(), io = controlledAdapter();
  const a = setup(), b = setup();
  for (const store of [a, b]) store.getState().configurePersistence({ adapter: io.adapter, storage, storageKey: "shared" });
  a.getState().updateNode(0, { name: "A" });
  const saving = a.getState().saveGraph();
  await until(() => io.writes.length === 1, "write starts");
  b.getState().updateNode(0, { name: "B is still unsaved" });
  io.writes[0].gate.resolve({ revision: "a-saved" }); await saving;
  assert.equal(JSON.parse(storage.getItem("shared")!).document.nodes[0].name, "B is still unsaved");
});

test("storage failure is reported without discarding the editable document", () => {
  const store = setup();
  store.getState().configurePersistence({ storage: { getItem: () => null,
    setItem: () => { throw new Error("Quota exceeded"); }, removeItem: () => {} } });
  store.getState().updateNode(0, { name: "Still in memory" });
  assert.equal(store.getState().graph.nodes[0].name, "Still in memory");
  assert.equal(store.getState().isDirty, true);
  assert.match(store.getState().draftError ?? "", /recovery draft/i);
});

test("reconfiguring persistence rejects stale completions from the previous adapter", async () => {
  const store = setup(), old = controlledAdapter(), fresh = controlledAdapter();
  store.getState().configurePersistence({ adapter: old.adapter, storage: null });
  store.getState().updateNode(0, { name: "New graph" });
  const stale = store.getState().saveGraph();
  await until(() => old.writes.length === 1, "old adapter starts");
  store.getState().configurePersistence({ adapter: fresh.adapter, storage: null });
  const current = store.getState().saveGraph();
  await until(() => fresh.writes.length === 1, "new adapter starts");
  old.writes[0].gate.resolve({ revision: "stale" });
  assert.equal(await stale, false);
  assert.equal(store.getState().isDirty, true);
  fresh.writes[0].gate.resolve({ revision: "fresh" });
  assert.equal(await current, true);
  assert.equal(store.getState().isDirty, false);
});
