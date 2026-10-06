// ============================================================
// Threadrift — Zustand Store
// ============================================================

import { type StateCreator } from "zustand";
import { PersistenceCoordinator, type Draft } from "../persistence/coordinator";
import type { PersistenceOptions } from "../persistence/types";
import { getRestingNodeIndex, resolvePathSelection, selectForwardPath } from "./navigation";
import { advanceMotion, routeState, targetPatch, type InputSession, type InputSource } from "./controller";
import { CAMERA_RETURN_MS, cameraNavigationBlocked, resolveCamera } from "./camera-state";

import {
  type GraphData,
  type Point,
  type CameraTransition,
  isCameraView,
  isCameraTransition,
  nodeCamera,
  type GraphNode,
  type GraphEdge,
  type GraphJSON,
  type Sequence,
  computeTopology,
  getActiveRoute,
  createRouteGeometry,
  progressToDistance,
  distanceToProgress,
  parseGraphDocument,
  serializeGraphDocument,
  validateGraphData,
  DEFAULT_DOCUMENT_SETTINGS,
  PHYSICS_BOUNDS,
  type GraphDocument,
  type JsonObject,
  type PhysicsSettings,
  type RouteGeometry,
  getMainOutgoing,
  getNode,
  getNodeEditCapabilities,
} from "@threadrift/core";

// ── Store Interface ─────────────────────────────────────────

export type PhysicsConfig = PhysicsSettings;

export interface ThreadriftStore {
  // Graph data
  graph: GraphData;
  nextNodeId: number;
  sequences: Sequence[];
  isLoaded: boolean;
  graphError: string | null;
  graphRevision: number;

  // Persistence & Auto-Save
  saveStatus: "idle" | "dirty" | "saving" | "saved" | "error";
  lastSaved: number | null;
  autoSaveEnabled: boolean;
  isDirty: boolean;
  saveError: string | null;
  draftError: string | null;
  documentRevision: number;
  hasRecoveryDraft: boolean;
  extensions?: JsonObject;
  settingsExtensions?: JsonObject;

  // Physics settings
  physics: PhysicsConfig;

  // Camera state
  scrollTarget: number;
  scrollCurrent: number;
  activePath: GraphNode[];
  activeEdges: GraphEdge[];
  routeGeometry: RouteGeometry | null;
  distanceCurrent: number;
  distanceTarget: number;
  travelDirection: -1 | 0 | 1;
  travelledEdges: string[];
  inputSession: InputSession | null;
  inputGeneration: number;
  navigationElement: HTMLElement | null;
  branchChoices: Record<number, string>;
  isScrolling: boolean;

  // UI state
  selectedNode: number | null;
  selectedEdge: string | null;
  editorOpen: boolean;
  nodeDragActive: boolean;
  nodeEditId: number | null;
  editorNotice: string | null;
  cameraMode: "follow" | "freeze" | "position" | "preview";
  cameraOverride: Point | null;
  cameraReturn: { from: Point; elapsed: number } | null;
  setCameraMode: (mode: "follow" | "freeze" | "position") => void;
  moveCameraPreview: (point: Point) => void;
  previewNodeCamera: (id: number) => void;
  captureNodeCamera: (id: number) => void;
  setNodeCamera: (id: number, camera: Point | undefined) => void;
  setEdgeCamera: (id: string, camera: CameraTransition | undefined) => void;
  beginNodeEdit: (id: number) => number | null;
  previewNodePosition: (token: number, position: Point) => void;
  finishNodeEdit: (token: number, commit: boolean) => void;
  cancelNodeEdit: () => void;
  setNodeDragActive: (active: boolean) => void;
  mergeModeSource: number | null;

  // Discovery state
  visitedNodes: Set<number>;

  // Actions — Graph
  loadGraph: (data: GraphJSON, options?: { revision?: string | null; source?: "disk" | "import" | "draft" }) => void;
  importGraph: (data: GraphJSON) => void;
  recompute: () => void;
  addNode: (parentId: number, mode: "main" | "branch") => GraphNode | null;
  removeNode: (id: number) => void;
  updateNode: (id: number, patch: Partial<GraphNode>) => void;
  updateEdge: (id: string, patch: Partial<GraphEdge>) => void;
  removeEdge: (id: string) => void;
  mergeNode: (fromId: number, toId: number) => void;

  // Actions — Persistence
  saveGraph: () => Promise<boolean>;
  reloadGraph: (options?: { preserveDraft?: boolean }) => Promise<boolean>;
  setAutoSaveEnabled: (enabled: boolean) => void;
  configurePersistence: (options: PersistenceOptions | false) => void;
  attachPersistence: () => () => void;
  restoreDraft: () => void;
  discardDraft: () => void;
  setSaveStatus: (status: "idle" | "saving" | "saved" | "error") => void;

  // Actions — Physics
  updatePhysics: (patch: Partial<PhysicsConfig>) => void;

  // Actions — Navigation
  setScrollTarget: (val: number) => void;
  setScrollCurrent: (val: number) => void;
  setIsScrolling: (val: boolean) => void;
  setBranchChoice: (nodeId: number, edgeId: string | null) => void;
  refreshActivePath: () => void;
  setNavigationElement: (element: HTMLElement | null) => void;
  beginInput: (source: InputSource) => number | null;
  travelInput: (deltaDistance: number, sessionId: number) => void;
  endInput: (sessionId: number) => void;
  cancelInput: () => void;
  advanceNavigation: (dtMs: number, reducedMotion: boolean) => void;
  stepNavigation: (direction: -1 | 1) => void;

  // Actions — UI
  selectNode: (id: number | null) => void;
  selectEdge: (id: string | null) => void;
  focusNode: (id: number) => void;
  focusEdge: (id: string) => void;
  toggleEditor: () => void;
  setMergeMode: (sourceId: number | null) => void;

  // Actions — Discovery
  markVisited: (nodeId: number) => void;

  // Serialization
  toJSON: () => GraphDocument;
}

// ── Store Implementation ────────────────────────────────────

/** Prepare an entire graph revision before publishing it to subscribers. */
function prepareGraph(state: ThreadriftStore, candidate: GraphData, reset = false, preview = false): Partial<ThreadriftStore> {
  // Local connection deletion/movement restores automatic routing. Newly supplied
  // invalid recommendations and invalid imports still fail validation below.
  if (!reset) candidate = { ...candidate, nodes: Object.fromEntries(Object.entries(candidate.nodes).map(([id, node]) => {
    const inherited = node.recommendedEdgeId && node.recommendedEdgeId === state.graph.nodes[id]?.recommendedEdgeId;
    return [id, inherited && !candidate.edges.some(edge => edge.id === node.recommendedEdgeId && edge.from === node.id)
      ? { ...node, recommendedEdgeId: undefined } : node];
  })) };
  let nextNodeId = state.nextNodeId;
  for (const node of Object.values(candidate.nodes)) nextNodeId = Math.max(nextNodeId, node.id + 1);
  // A position preview starts from already-validated committed data and changes
  // only x/y plus a validated camera point. Avoid serializing the document on
  // every pointer sample. Clone nodes because topology writes computed fields.
  const authored = preview ? validateGraphData(candidate) : serializeGraphDocument({ graph: candidate, nextNodeId, settings: DEFAULT_DOCUMENT_SETTINGS });
  const graph: GraphData = { root: authored.root,
    nodes: preview ? Object.fromEntries(Object.entries(authored.nodes).map(([id, node]) => [id, { ...node }])) : authored.nodes,
    edges: authored.edges };
  const { sequences } = computeTopology(graph);
  // Inactive edges also need valid derived geometry during a live preview.
  if (preview) for (const edge of graph.edges) createRouteGeometry(graph, sequences, { nodes: [graph.nodes[edge.from], graph.nodes[edge.to]], edges: [edge] });
  const choices = reset ? {} : Object.fromEntries(Object.entries(state.branchChoices).filter(([id, edgeId]) =>
    graph.edges.some((edge) => edge.id === edgeId && edge.from === Number(id))));
  const route = getActiveRoute(graph, choices);
  const activeIds = new Set(route.nodes.map((node) => node.id));
  const branchChoices = Object.fromEntries(Object.entries(choices).filter(([id]) => activeIds.has(Number(id))));
  const routeGeometry = createRouteGeometry(graph, sequences, route);
  let index = reset ? 0 : Math.min(Math.floor(state.scrollCurrent), state.activePath.length - 1);
  while (index > 0 && (route.nodes[index]?.id !== state.activePath[index]?.id ||
    state.activeEdges.slice(0, index).some((edge, i) => route.edges[i]?.id !== edge.id))) index--;
  index = Math.max(0, Math.min(index, route.nodes.length - 1));
  const distance = routeGeometry.nodeDistances[index] ?? 0;
  return { graph, sequences, activePath: route.nodes, activeEdges: route.edges, branchChoices, routeGeometry,
    mergeModeSource: state.mergeModeSource !== null && graph.nodes[state.mergeModeSource] ? state.mergeModeSource : null,
    scrollCurrent: index, scrollTarget: index, distanceCurrent: distance, distanceTarget: distance,
    inputSession: null, isScrolling: false, travelDirection: 0, graphError: null, graphRevision: state.graphRevision + 1,
    travelledEdges: route.edges.slice(0, index).map((edge) => edge.id) };
}

export const createThreadriftStore: StateCreator<ThreadriftStore> = (set, get) => {
  let recovery: Draft | null = null;
  let loadGeneration = 0;
  let editGeneration = 0;
  let edit: { token: number; nodeId: number; start: ThreadriftStore; moved: boolean } | null = null;
  const persistence = new PersistenceCoordinator({
    snapshot: () => get().toJSON(), loaded: () => get().isLoaded,
    autoSave: () => get().autoSaveEnabled, report: patch => set(patch),
  });
  return ({
  // Initial state
  graph: { nodes: {}, edges: [], root: 0 },
  nextNodeId: 0,
  sequences: [],
  isLoaded: false,
  graphError: null,
  graphRevision: 0,

  saveStatus: "idle",
  lastSaved: null,
  autoSaveEnabled: true,
  isDirty: false, saveError: null, draftError: null, documentRevision: 0, hasRecoveryDraft: false,

  physics: { ...DEFAULT_DOCUMENT_SETTINGS.physics },

  scrollTarget: 0,
  scrollCurrent: 0,
  activePath: [],
  activeEdges: [],
  routeGeometry: null,
  distanceCurrent: 0,
  distanceTarget: 0,
  travelDirection: 0,
  travelledEdges: [],
  inputSession: null,
  inputGeneration: 0,
  navigationElement: null,
  branchChoices: {},
  isScrolling: false,
  selectedNode: null,
  selectedEdge: null,
  editorOpen: false,
  nodeDragActive: false,
  nodeEditId: null, editorNotice: null,
  cameraMode: "follow", cameraOverride: null, cameraReturn: null,
  mergeModeSource: null,
  visitedNodes: new Set<number>(),

  // ── Graph Actions ───────────────────────────────────────

  loadGraph: (input, options = {}) => {
    const data = parseGraphDocument(input);
    get().cancelNodeEdit();
    const graph: GraphData = { nodes: data.nodes, edges: data.edges, root: data.root };
    const prepared = prepareGraph(get(), graph, true);
    // Validation and geometry complete before any document or persistence state changes.
    loadGeneration++;
    set({ ...prepared, nextNodeId: data.nextNodeId, physics: { ...data.settings.physics },
      autoSaveEnabled: data.settings.editor.autoSaveEnabled,
      extensions: data.extensions, settingsExtensions: data.settings.extensions,
      selectedNode: null, selectedEdge: null, mergeModeSource: null,
      cameraMode: "follow", cameraOverride: null, cameraReturn: null, nodeDragActive: false, editorNotice: null,
      visitedNodes: new Set<number>(), isLoaded: true, hasRecoveryDraft: false,
    });
    persistence.accept(options.revision, options.source === "import" || options.source === "draft");
  },
  importGraph: data => get().loadGraph(data, { source: "import" }),

  recompute: () => {
    get().cancelNodeEdit();
    set(prepareGraph(get(), get().graph));
  },

  addNode: (parentId, mode) => {
    get().cancelNodeEdit();
    const { graph, nextNodeId } = get();
    const parent = getNode(graph, parentId);
    if (!parent) return null;

    const capabilities = getNodeEditCapabilities(graph, parentId);
    if (mode === "branch" ? !capabilities.canAddBranch : !capabilities.canAddMain) return null;

    // Calculate position based on parent tangent
    let dx = 140,
      dy = 130;
    if (parent.vx !== undefined && parent.vy !== undefined) {
      const ux = parent.vx,
        uy = parent.vy;
      const px = -uy,
        py = ux;
      if (mode === "main") {
        dx = ux * 180;
        dy = uy * 180;
      } else {
        const side = nextNodeId % 2 === 0 ? -1 : 1;
        dx = ux * 130 + px * 130 * side;
        dy = uy * 130 + py * 130 * side;
      }
    }

    const newNode: GraphNode = {
      id: nextNodeId,
      name: `Node ${nextNodeId}`,
      content: "",
      x: Math.max(20, Math.min(980, parent.x + dx)),
      y: Math.max(20, Math.min(980, parent.y + dy)),
    };

    const type = mode === "main" ? ("main" as const) : ("branch" as const);

    const newEdge: GraphEdge = {
      id: "e" + crypto.randomUUID(),
      from: parentId,
      to: newNode.id,
      type,
      curve: 0,
      diverge: 0,
    };

    try { set({
      ...prepareGraph(get(), { ...graph, nodes: { ...graph.nodes, [newNode.id]: newNode }, edges: [...graph.edges, newEdge] }),
      nextNodeId: nextNodeId + 1,
      selectedNode: newNode.id,
      selectedEdge: null,
    }); } catch (error) { set({ graphError: String(error) }); return null; }
    persistence.changed();
    return newNode;
  },

  removeNode: (id) => {
    get().cancelNodeEdit();
    const { graph } = get();
    if (id === graph.root) return;

    // Find all nodes to delete: if a node loses all its incoming edges, it should be deleted.
    const nodesToDelete = new Set<number>([id]);
    
    const indegree = new Map<number, number>();
    for (const edge of graph.edges) {
      indegree.set(edge.to, (indegree.get(edge.to) || 0) + 1);
    }

    const queue = [id];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      nodesToDelete.add(curr);
      
      for (const edge of graph.edges) {
        if (edge.from === curr) {
          const toId = edge.to;
          const deg = (indegree.get(toId) || 0) - 1;
          indegree.set(toId, deg);
          
          if (deg <= 0 && toId !== graph.root && !nodesToDelete.has(toId)) {
            queue.push(toId);
          }
        }
      }
    }

    const newNodes = { ...graph.nodes };
    nodesToDelete.forEach((n) => {
      delete newNodes[n];
    });

    const newEdges = graph.edges.filter(
      (e) => !nodesToDelete.has(e.from) && !nodesToDelete.has(e.to)
    );

    set({
      ...prepareGraph(get(), { ...graph, nodes: newNodes, edges: newEdges }),
      selectedNode: graph.root,
      selectedEdge: null,
    });
    persistence.changed();
  },

  updateNode: (id, patch) => {
    if (Object.keys(patch).length === 1 && Object.hasOwn(patch, "camera")) { get().setNodeCamera(id, patch.camera); return; }
    get().cancelNodeEdit();
    const state = get();
    if (!state.graph.nodes[id]) return;
    const moved = (patch.x !== undefined && patch.x !== state.graph.nodes[id].x) || (patch.y !== undefined && patch.y !== state.graph.nodes[id].y);
    if (moved && state.cameraMode === "freeze" && state.cameraOverride) patch = { ...patch, camera: { ...state.cameraOverride } };
    try { set(prepareGraph(state, { ...state.graph, nodes: { ...state.graph.nodes, [id]: { ...state.graph.nodes[id], ...patch } } })); }
    catch (error) { set({ graphError: String(error) }); return; }
    persistence.changed();
  },

  updateEdge: (id, patch) => {
    if (Object.keys(patch).length === 1 && Object.hasOwn(patch, "camera")) { get().setEdgeCamera(id, patch.camera); return; }
    get().cancelNodeEdit();
    const state = get();
    if (!state.graph.edges.some((edge) => edge.id === id)) return;
    try { set(prepareGraph(state, { ...state.graph, edges: state.graph.edges.map((edge) => edge.id === id ? { ...edge, ...patch } : edge) })); }
    catch (error) { set({ graphError: String(error) }); return; }
    persistence.changed();
  },

  removeEdge: (id) => {
    get().cancelNodeEdit();
    const state = get();
    set({
      ...prepareGraph(state, { ...state.graph, edges: state.graph.edges.filter((edge) => edge.id !== id) }),
      selectedEdge: null,
    });
    persistence.changed();
  },

  mergeNode: (fromId, toId) => {
    get().cancelNodeEdit();
    const { graph } = get();
    if (graph.edges.some((e) => e.from === fromId && e.to === toId)) return;

    const newEdge: GraphEdge = {
      id: "e" + crypto.randomUUID(),
      from: fromId,
      to: toId,
      type: "branch",
      curve: 0,
      diverge: 0,
    };

    try { set({
      ...prepareGraph(get(), { ...graph, edges: [...graph.edges, newEdge] }),
      selectedEdge: newEdge.id,
      selectedNode: null,
    }); } catch (error) { set({ graphError: String(error) }); return; }
    persistence.changed();
  },

  // ── Persistence Actions ───────────────────────────────────

  saveGraph: () => persistence.flush(),
  configurePersistence: options => { loadGeneration++; persistence.configure(options); },
  setAutoSaveEnabled: enabled => {
    if (typeof enabled !== "boolean" || enabled === get().autoSaveEnabled) return;
    set({ autoSaveEnabled: enabled });
    persistence.changed();
  },
  reloadGraph: async (options = {}) => {
    if (get().nodeEditId !== null) { set({ saveError: "Finish or cancel the node edit before reloading." }); return false; }
    if (persistence.saving) { set({ saveError: "A save is in progress. Reload once it finishes." }); return false; }
    if (get().isDirty && !options.preserveDraft) { set({ saveError: "Save your changes before reloading from disk." }); return false; }
    if (get().isDirty && !persistence.backup()) {
      set({ saveError: "Export your edits first; the latest recovery draft could not be stored." }); return false;
    }
    const retainedDraft = get().isDirty ? persistence.readDraft() : null;
    if (get().isDirty && !retainedDraft) { set({ saveError: "Export your edits first; a recovery draft could not be stored." }); return false; }
    const request = ++loadGeneration;
    const version = persistence.currentVersion;
    const writeEpoch = persistence.currentWriteEpoch;
    const initial = !get().isLoaded;
    try {
      const loaded = await persistence.load();
      const document = parseGraphDocument(loaded.document);
      if (request !== loadGeneration || version !== persistence.currentVersion || get().nodeEditId !== null) return false;
      if (persistence.saving || writeEpoch !== persistence.currentWriteEpoch) {
        set({ saveError: "A save started during reload. Reload again to read its result." }); return false;
      }
      const draft = initial ? persistence.readDraft() : null;
      if (draft && draft.baseRevision === loaded.revision) {
        get().loadGraph(draft.document, { revision: loaded.revision, source: "draft" });
      } else {
        get().loadGraph(document, { revision: loaded.revision, source: "disk" });
        recovery = draft ?? retainedDraft;
        set({ hasRecoveryDraft: !!recovery });
      }
      return true;
    } catch (error) {
      if (request === loadGeneration && version === persistence.currentVersion && !persistence.saving && writeEpoch === persistence.currentWriteEpoch) {
        const draft = initial ? persistence.readDraft() : null;
        if (draft) {
          // Keep the draft's original precondition: never turn offline recovery into a blind overwrite.
          get().loadGraph(draft.document, { revision: draft.baseRevision, source: "draft" });
          set({ saveError: "Opened a local recovery draft. Disk could not be loaded; save will check for conflicts." });
          return true;
        }
        set({ saveError: error instanceof Error ? error.message : "Could not load graph data." });
      }
      return false;
    }
  },
  restoreDraft: () => {
    if (!recovery) return;
    const document = recovery.document;
    recovery = null;
    get().loadGraph(document, { source: "import" });
  },
  discardDraft: () => { recovery = null; persistence.discardDraft(); set({ hasRecoveryDraft: false }); },
  attachPersistence: () => {
    if (typeof window === "undefined") return () => persistence.detach();
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!get().isDirty) return;
      persistence.backup(); event.preventDefault(); event.returnValue = "";
    };
    const hidden = () => { if (document.hidden) persistence.backup(); };
    const pagehide = () => persistence.backup();
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("pagehide", pagehide);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      loadGeneration++;
      get().cancelNodeEdit();
      set({ cameraMode: "follow", cameraOverride: null, cameraReturn: null });
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("pagehide", pagehide);
      document.removeEventListener("visibilitychange", hidden);
      persistence.detach();
    };
  },
  setSaveStatus: status => set({ saveStatus: status }),

  // ── Physics Actions ───────────────────────────────────────

  updatePhysics: (patch) => {
    const bounds = PHYSICS_BOUNDS;
    const valid: Partial<PhysicsConfig> = {};
    for (const key of Object.keys(bounds) as (keyof PhysicsConfig)[]) {
      const value = patch[key];
      if (value !== undefined && Number.isFinite(value)) valid[key] = Math.max(bounds[key][0], Math.min(bounds[key][1], value));
    }
    if (Object.keys(valid).some(key => valid[key as keyof PhysicsConfig] !== get().physics[key as keyof PhysicsConfig])) {
      set(state => ({ physics: { ...state.physics, ...valid } }));
      persistence.changed();
    }
  },

  // ── Navigation Actions ──────────────────────────────────

  setScrollTarget: (val) => {
    const state = get();
    if (!Number.isFinite(val) || !state.routeGeometry || (state.nodeDragActive || cameraNavigationBlocked(state)) || state.inputSession) return;
    set(targetPatch(state, progressToDistance(state.routeGeometry, val)));
  },
  setScrollCurrent: (val) => {
    const state = get();
    if (!Number.isFinite(val) || !state.routeGeometry || (state.nodeDragActive || cameraNavigationBlocked(state))) return;
    // Legacy animation API may only advance within already-authorized travel.
    if (val < Math.min(state.scrollCurrent, state.scrollTarget) || val > Math.max(state.scrollCurrent, state.scrollTarget)) return;
    const distanceCurrent = progressToDistance(state.routeGeometry, val);
    const scrollCurrent = distanceToProgress(state.routeGeometry, distanceCurrent);
    set({ distanceCurrent, scrollCurrent, travelledEdges: state.activeEdges.slice(0, Math.ceil(scrollCurrent)).map((edge) => edge.id) });
  },
  setIsScrolling: (val) => set({ isScrolling: val }),

  setNavigationElement: (navigationElement) => set({ navigationElement }),
  beginInput: (source) => {
    const state = get();
    if (!state.isLoaded || (state.nodeDragActive || cameraNavigationBlocked(state)) || state.inputSession || !state.routeGeometry) return null;
    const id = state.inputGeneration + 1;
    set({ inputGeneration: id, inputSession: { id, source, blocked: false }, isScrolling: true });
    return id;
  },
  travelInput: (delta, sessionId) => {
    const state = get();
    if (!Number.isFinite(delta) || delta === 0 || (state.nodeDragActive || cameraNavigationBlocked(state)) ||
      !state.inputSession || state.inputSession.id !== sessionId || state.inputSession.blocked || !state.routeGeometry) return;
    const boundedDelta = Math.sign(delta) * Math.min(Math.abs(delta), 2000);
    const requested = state.distanceTarget + boundedDelta;
    const patch = targetPatch(state, requested);
    const progress = patch.scrollTarget ?? state.scrollTarget;
    const reachedFork = delta < 0 && Number.isInteger(progress) && progress < state.scrollTarget &&
      state.graph.edges.filter((edge) => edge.from === state.activePath[progress]?.id).length > 1;
    const blocked = patch.distanceTarget !== requested || reachedFork;
    set({ ...patch, inputSession: { ...state.inputSession, blocked } });
  },
  endInput: (sessionId) => {
    if (get().inputSession?.id === sessionId) set({ inputSession: null, isScrolling: false });
  },
  cancelInput: () => {
    const state = get();
    if (state.inputSession || state.isScrolling || state.scrollTarget !== state.scrollCurrent) {
      set({ inputSession: null, isScrolling: false, travelDirection: 0, scrollTarget: state.scrollCurrent, distanceTarget: state.distanceCurrent });
    }
  },
  advanceNavigation: (dt, reducedMotion) => {
    const returning = get().cameraReturn;
    if (returning) {
      if (!Number.isFinite(dt) || dt <= 0) return;
      const elapsed = returning.elapsed + Math.min(dt, 64);
      set({ cameraReturn: reducedMotion || elapsed >= CAMERA_RETURN_MS ? null : { ...returning, elapsed } });
      return;
    }
    if (get().cameraOverride) return;
    const patch = advanceMotion(get(), dt, reducedMotion);
    if (patch) set(patch);
  },
  stepNavigation: (direction) => {
    const state = get();
    if ((state.nodeDragActive || cameraNavigationBlocked(state)) || state.inputSession || state.isScrolling || state.scrollCurrent !== state.scrollTarget || !state.routeGeometry) return;
    const next = direction > 0 ? Math.floor(state.scrollCurrent) + 1 : Math.ceil(state.scrollCurrent) - 1;
    set(targetPatch(state, progressToDistance(state.routeGeometry, next)));
  },

  setBranchChoice: (nodeId, edgeId) => {
    const state = get();
    const restingIndex = getRestingNodeIndex(state);
    if (restingIndex === null) return;
    const choiceIndex = state.activePath.findIndex((node) => node.id === nodeId);
    if (choiceIndex < restingIndex) return;
    if (edgeId === null) edgeId = getMainOutgoing(state.graph, nodeId)?.id ?? null;
    if (edgeId === null || !state.graph.edges.some(
      (edge) => edge.id === edgeId && edge.from === nodeId && state.graph.nodes[edge.to]
    )) return;
    if ((state.branchChoices[nodeId] ?? null) === edgeId) return;

    const choices = { ...state.branchChoices };
    if (edgeId !== null) choices[nodeId] = edgeId;
    else delete choices[nodeId];
    const selection = resolvePathSelection(state, choices);
    if (selection) set({ ...selection, ...routeState(state, selection.branchChoices) });
  },

  refreshActivePath: () => {
    get().recompute();
  },

  // ── UI Actions ──────────────────────────────────────────

  focusNode: (id) => {
    const state = get();
    const selection = selectForwardPath(state, { nodeId: id });
    if (selection) set({ ...selection, ...routeState(state, selection.branchChoices) });
  },

  focusEdge: (id) => {
    const state = get();
    const selection = selectForwardPath(state, { edgeId: id });
    if (selection) set({ ...selection, ...routeState(state, selection.branchChoices) });
  },

  selectNode: (id) => { if (id !== get().selectedNode) get().cancelNodeEdit(); set({ selectedNode: id, selectedEdge: null }); },
  selectEdge: (id) => { get().cancelNodeEdit(); set({ selectedEdge: id, selectedNode: null }); },
  setNodeDragActive: active => {
    if (active) get().cancelInput();
    set({ nodeDragActive: active });
  },
  toggleEditor: () => {
    get().cancelNodeEdit();
    if (get().editorOpen) get().setCameraMode("follow");
    get().cancelInput();
    set((s) => ({ editorOpen: !s.editorOpen, mergeModeSource: null }));
  },
  setMergeMode: (sourceId) => { get().cancelNodeEdit(); if (sourceId !== null) get().setCameraMode("follow"); set({ mergeModeSource: sourceId }); },

  // Camera previews are runtime state; saved views are authored node metadata.
  setCameraMode: mode => {
    if (!get().editorOpen && mode !== "follow") return;
    get().cancelNodeEdit();
    if (mode === get().cameraMode) return;
    const from = { ...resolveCamera(get()) };
    if (mode !== "follow" && !isCameraView(from)) { set({ graphError: "This view is outside the supported camera range." }); return; }
    get().cancelInput();
    set({ cameraMode: mode, cameraOverride: mode === "follow" ? null : from,
      cameraReturn: mode === "follow" ? { from, elapsed: 0 } : null, mergeModeSource: null, editorNotice: null });
  },
  moveCameraPreview: point => {
    if (get().cameraMode !== "position" || !isCameraView(point)) return;
    set({ cameraOverride: { ...point } });
  },
  previewNodeCamera: id => {
    get().cancelNodeEdit();
    const node = get().graph.nodes[id];
    if (!get().editorOpen || !node || !isCameraView(nodeCamera(node))) return;
    get().cancelInput();
    set({ cameraMode: "preview", cameraOverride: { ...nodeCamera(node) }, cameraReturn: null, mergeModeSource: null });
  },
  captureNodeCamera: id => {
    if (!get().editorOpen || !get().graph.nodes[id]) return;
    const camera = { ...resolveCamera(get()) };
    get().setCameraMode("freeze");
    get().setNodeCamera(id, camera);
  },
  setNodeCamera: (id, camera) => {
    if (camera !== undefined && !isCameraView(camera)) { set({ graphError: "Camera X/Y must be finite and within +/-1e9." }); return; }
    get().cancelNodeEdit();
    const state = get(), original = state.graph.nodes[id];
    if (!original || (original.camera?.x === camera?.x && original.camera?.y === camera?.y)) return;
    const node = { ...original, camera: camera ? { ...camera } : undefined };
    const replace = (n: GraphNode) => n.id === id ? node : n;
    const activePath = state.activePath.map(replace);
    set({ graph: { ...state.graph, nodes: { ...state.graph.nodes, [id]: node } }, activePath,
      sequences: state.sequences.map(sequence => ({ ...sequence, nodes: sequence.nodes.map(replace) })),
      routeGeometry: state.routeGeometry ? { ...state.routeGeometry, nodes: activePath } : null,
      graphRevision: state.graphRevision + 1, graphError: null });
    persistence.changed();
  },
  setEdgeCamera: (id, camera) => {
    if (camera !== undefined && !isCameraTransition(camera)) { set({ graphError: "Camera travel needs 0 <= start < end <= 100%, with at least 0.1% between them." }); return; }
    get().cancelNodeEdit();
    const state = get(), original = state.graph.edges.find(edge => edge.id === id);
    if (!original || JSON.stringify(original.camera) === JSON.stringify(camera)) return;
    const edge = { ...original, camera: camera ? { ...camera } : undefined };
    set({ graph: { ...state.graph, edges: state.graph.edges.map(e => e.id === id ? edge : e) },
      activeEdges: state.activeEdges.map(e => e.id === id ? edge : e),
      routeGeometry: state.routeGeometry ? { ...state.routeGeometry, edges: state.routeGeometry.edges.map(e => e.id === id ? { ...e, camera: edge.camera } : e) } : null,
      graphRevision: state.graphRevision + 1, graphError: null });
    persistence.changed();
  },
  beginNodeEdit: id => {
    get().cancelNodeEdit();
    if (!get().editorOpen || !get().graph.nodes[id] || get().cameraMode === "position" || get().cameraReturn) return null;
    get().cancelInput();
    const token = ++editGeneration;
    edit = { token, nodeId: id, start: get(), moved: false };
    // Invalidate any read already in flight before the first preview update.
    loadGeneration++;
    set({ nodeEditId: token, nodeDragActive: true, editorNotice: null });
    return token;
  },
  previewNodePosition: (token, point) => {
    if (!edit || edit.token !== token) return;
    const original = edit.start.graph.nodes[edit.nodeId];
    const moved = point.x !== original.x || point.y !== original.y;
    const camera = moved && edit.start.cameraMode === "freeze" ? edit.start.cameraOverride : original.camera;
    try {
      const candidate = { ...edit.start.graph, nodes: { ...edit.start.graph.nodes,
        [original.id]: { ...original, x: point.x, y: point.y, camera: camera ? { ...camera } : undefined } } };
      const prepared = prepareGraph(get(), candidate, false, true);
      edit.moved = moved;
      set(prepared);
    } catch (error) { set({ graphError: String(error) }); }
  },
  finishNodeEdit: (token, commit) => {
    if (!edit || edit.token !== token) return;
    const completed = edit;
    let prepared: Partial<ThreadriftStore> = {};
    let failure: string | null = null;
    if (commit && completed.moved) {
      try { prepared = prepareGraph(get(), get().graph); }
      catch (error) { commit = false; failure = String(error); }
    }
    edit = null;
    if (commit && completed.moved) {
      set({ ...prepared, nodeEditId: null, nodeDragActive: false, editorNotice: null });
      persistence.changed();
    } else {
      const start = completed.start;
      set({ graph: start.graph, sequences: start.sequences, activePath: start.activePath, activeEdges: start.activeEdges,
        routeGeometry: start.routeGeometry, branchChoices: start.branchChoices, scrollCurrent: start.scrollCurrent,
        scrollTarget: start.scrollTarget, distanceCurrent: start.distanceCurrent, distanceTarget: start.distanceTarget,
        travelDirection: start.travelDirection, travelledEdges: start.travelledEdges, graphError: failure,
        graphRevision: get().graphRevision + 1, nodeEditId: null, nodeDragActive: false,
        editorNotice: !commit && completed.moved ? "Unfinished node move cancelled." : null });
    }
  },
  cancelNodeEdit: () => { if (edit) get().finishNodeEdit(edit.token, false); },

  // ── Discovery ───────────────────────────────────────────

  markVisited: (nodeId) => {
    set((state) => {
      const visited = new Set(state.visitedNodes);
      visited.add(nodeId);
      return { visitedNodes: visited };
    });
  },

  // ── Serialization ───────────────────────────────────────

  toJSON: () => {
    const { graph, nextNodeId, physics, autoSaveEnabled, extensions, settingsExtensions } = get();
    return serializeGraphDocument({ graph: edit?.start.graph ?? graph, nextNodeId, extensions, settings: {
      physics, editor: { autoSaveEnabled }, ...(settingsExtensions ? { extensions: settingsExtensions } : {}),
    } });
  },
});
};
