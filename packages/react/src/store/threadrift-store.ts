// ============================================================
// Threadrift — Zustand Store
// ============================================================

import { type StateCreator } from "zustand";

import {
  type GraphData,
  type GraphNode,
  type GraphEdge,
  type GraphJSON,
  type Sequence,
  computeTopology,
  getActivePath,
  getMainOutgoing,
  getNode,
  clearPathCache,
  MAX_BRANCH_DEPTH,
  SCROLL_SENSITIVITY,
  TOUCH_SENSITIVITY,
  SNAP_STRENGTH,
  SNAP_THRESHOLD,
} from "@threadrift/core";

// ── Store Interface ─────────────────────────────────────────

export interface PhysicsConfig {
  scrollSensitivity: number;
  touchSensitivity: number;
  snapStrength: number;
  snapThreshold: number;
}

export interface ThreadriftStore {
  // Graph data
  graph: GraphData;
  nextNodeId: number;
  sequences: Sequence[];
  isLoaded: boolean;

  // Persistence & Auto-Save
  saveStatus: "idle" | "saving" | "saved" | "error";
  lastSaved: number | null;
  autoSaveEnabled: boolean;

  // Physics settings
  physics: PhysicsConfig;

  // Camera state
  scrollTarget: number;
  scrollCurrent: number;
  activePath: GraphNode[];
  branchChoices: Record<number, string>;
  isScrolling: boolean;

  // UI state
  selectedNode: number | null;
  selectedEdge: string | null;
  editorOpen: boolean;
  mergeModeSource: number | null;

  // Discovery state
  visitedNodes: Set<number>;

  // Actions — Graph
  loadGraph: (data: GraphJSON) => void;
  recompute: () => void;
  addNode: (parentId: number, mode: "main" | "branch") => GraphNode | null;
  removeNode: (id: number) => void;
  updateNode: (id: number, patch: Partial<GraphNode>) => void;
  updateEdge: (id: string, patch: Partial<GraphEdge>) => void;
  removeEdge: (id: string) => void;
  mergeNode: (fromId: number, toId: number) => void;

  // Actions — Persistence
  saveGraph: () => Promise<boolean>;
  setSaveStatus: (status: "idle" | "saving" | "saved" | "error") => void;

  // Actions — Physics
  updatePhysics: (patch: Partial<PhysicsConfig>) => void;

  // Actions — Navigation
  setScrollTarget: (val: number) => void;
  setScrollCurrent: (val: number) => void;
  setIsScrolling: (val: boolean) => void;
  setBranchChoice: (nodeId: number, edgeId: string | null) => void;
  refreshActivePath: () => void;

  // Actions — UI
  selectNode: (id: number | null) => void;
  selectEdge: (id: string | null) => void;
  focusNode: (id: number) => void;
  toggleEditor: () => void;
  setMergeMode: (sourceId: number | null) => void;

  // Actions — Discovery
  markVisited: (nodeId: number) => void;

  // Serialization
  toJSON: () => GraphJSON;
}

// ── Debounced Auto-Save Helper ───────────────────────────────

let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

function triggerAutoSave(
  get: () => ThreadriftStore,
  set: (fn: (state: ThreadriftStore) => Partial<ThreadriftStore>) => void
) {
  const state = get();
  if (!state.isLoaded || !state.autoSaveEnabled) return;

  set(() => ({ saveStatus: "saving" }));

  if (autoSaveTimer) clearTimeout(autoSaveTimer);

  autoSaveTimer = setTimeout(async () => {
    try {
      const data = get().toJSON();

      // 1. Instant local storage backup
      try {
        localStorage.setItem("threadrift-graph-backup", JSON.stringify(data));
      } catch {
        /* ignore */
      }

      // 2. Persist permanently to disk via Next.js API route
      const res = await fetch("/api/graph", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        throw new Error(`Auto-save failed with status ${res.status}`);
      }

      set(() => ({ saveStatus: "saved", lastSaved: Date.now() }));

      // Reset to idle status after 3s
      setTimeout(() => {
        if (get().saveStatus === "saved") {
          set(() => ({ saveStatus: "idle" }));
        }
      }, 3000);
    } catch (err) {
      console.warn("[Threadrift AutoSave] Failed to save graph permanently:", err);
      set(() => ({ saveStatus: "error" }));
    }
  }, 250);
}

// ── Store Implementation ────────────────────────────────────

export const createThreadriftStore: StateCreator<ThreadriftStore> = (set, get) => ({
  // Initial state
  graph: { nodes: {}, edges: [], root: 0 },
  nextNodeId: 0,
  sequences: [],
  isLoaded: false,

  saveStatus: "idle",
  lastSaved: null,
  autoSaveEnabled: true,

  physics: {
    scrollSensitivity: SCROLL_SENSITIVITY,
    touchSensitivity: TOUCH_SENSITIVITY,
    snapStrength: SNAP_STRENGTH,
    snapThreshold: SNAP_THRESHOLD,
  },

  scrollTarget: 0,
  scrollCurrent: 0,
  activePath: [],
  branchChoices: {},
  isScrolling: false,
  selectedNode: null,
  selectedEdge: null,
  editorOpen: false,
  mergeModeSource: null,
  visitedNodes: new Set<number>(),

  // ── Graph Actions ───────────────────────────────────────

  loadGraph: (data) => {
    const graph: GraphData = {
      nodes: data.nodes,
      edges: data.edges,
      root: data.root,
    };

    // Restore visited nodes from localStorage
    let visited = new Set<number>();
    try {
      const stored = localStorage.getItem("threadrift-visited");
      if (stored) visited = new Set(JSON.parse(stored));
    } catch {
      /* ignore */
    }

    set({
      graph,
      nextNodeId: data.nextNodeId,
      selectedNode: data.root,
      visitedNodes: visited,
      isLoaded: true,
      saveStatus: "idle",
    });
    get().recompute();
  },

  recompute: () => {
    const { graph, branchChoices } = get();
    clearPathCache();
    const { sequences } = computeTopology(graph);
    const activePath = getActivePath(graph, branchChoices);
    set({ sequences, activePath });
  },

  addNode: (parentId, mode) => {
    const { graph, nextNodeId } = get();
    const parent = getNode(graph, parentId);
    if (!parent) return null;

    if (mode === "branch" && (parent.level ?? 1) >= MAX_BRANCH_DEPTH) return null;

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
    if (type === "main" && getMainOutgoing(graph, parentId)) return null;

    const newEdge: GraphEdge = {
      id: "e" + crypto.randomUUID(),
      from: parentId,
      to: newNode.id,
      type,
      curve: 0,
      diverge: 0,
    };

    set((state) => ({
      graph: {
        ...state.graph,
        nodes: { ...state.graph.nodes, [newNode.id]: newNode },
        edges: [...state.graph.edges, newEdge],
      },
      nextNodeId: nextNodeId + 1,
      selectedNode: newNode.id,
      selectedEdge: null,
    }));

    get().recompute();
    triggerAutoSave(get, set);
    return newNode;
  },

  removeNode: (id) => {
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

    set((state) => ({
      graph: {
        ...state.graph,
        nodes: newNodes,
        edges: newEdges,
      },
      selectedNode: graph.root,
      selectedEdge: null,
    }));

    get().recompute();
    triggerAutoSave(get, set);
  },

  updateNode: (id, patch) => {
    set((state) => ({
      graph: {
        ...state.graph,
        nodes: {
          ...state.graph.nodes,
          [id]: { ...state.graph.nodes[id], ...patch },
        },
      },
    }));
    get().recompute();
    triggerAutoSave(get, set);
  },

  updateEdge: (id, patch) => {
    set((state) => ({
      graph: {
        ...state.graph,
        edges: state.graph.edges.map((e) =>
          e.id === id ? { ...e, ...patch } : e
        ),
      },
    }));
    get().recompute();
    triggerAutoSave(get, set);
  },

  removeEdge: (id) => {
    set((state) => ({
      graph: {
        ...state.graph,
        edges: state.graph.edges.filter((e) => e.id !== id),
      },
      selectedEdge: null,
    }));
    get().recompute();
    triggerAutoSave(get, set);
  },

  mergeNode: (fromId, toId) => {
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

    set((state) => ({
      graph: {
        ...state.graph,
        edges: [...state.graph.edges, newEdge],
      },
      selectedEdge: newEdge.id,
      selectedNode: null,
    }));

    get().recompute();
    triggerAutoSave(get, set);
  },

  // ── Persistence Actions ───────────────────────────────────

  saveGraph: async () => {
    set({ saveStatus: "saving" });
    try {
      const data = get().toJSON();
      try {
        localStorage.setItem("threadrift-graph-backup", JSON.stringify(data));
      } catch {
        /* ignore */
      }

      const res = await fetch("/api/graph", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) throw new Error("Save failed");

      set({ saveStatus: "saved", lastSaved: Date.now() });
      setTimeout(() => {
        if (get().saveStatus === "saved") {
          set({ saveStatus: "idle" });
        }
      }, 3000);
      return true;
    } catch (err) {
      console.warn("[Threadrift] Manual save failed:", err);
      set({ saveStatus: "error" });
      return false;
    }
  },

  setSaveStatus: (status) => set({ saveStatus: status }),

  // ── Physics Actions ───────────────────────────────────────

  updatePhysics: (patch) => {
    set((state) => ({
      physics: { ...state.physics, ...patch },
    }));
  },

  // ── Navigation Actions ──────────────────────────────────

  setScrollTarget: (val) => set({ scrollTarget: val }),
  setScrollCurrent: (val) => set({ scrollCurrent: val }),
  setIsScrolling: (val) => set({ isScrolling: val }),

  setBranchChoice: (nodeId, edgeId) => {
    set((state) => {
      const choices = { ...state.branchChoices };
      if (edgeId) {
        choices[nodeId] = edgeId;
      } else {
        delete choices[nodeId];
      }
      return { branchChoices: choices };
    });
    get().refreshActivePath();
  },

  refreshActivePath: () => {
    const { graph, branchChoices } = get();
    const activePath = getActivePath(graph, branchChoices);
    set({ activePath });
  },

  // ── UI Actions ──────────────────────────────────────────

  focusNode: (id) => {
    const { graph, scrollTarget, activePath, isScrolling } = get();

    // STRICT CONDITION: Only allow path change if scroll is at COMPLETE REST on a node
    const currentIdx = Math.round(scrollTarget);
    const isAtRest = !isScrolling && Math.abs(scrollTarget - currentIdx) < 0.001;
    
    if (!isAtRest) {
      return; // Do not change path if user is moving or between nodes
    }

    // Check if the node is already on the active path and behind us — if so, do nothing
    const existingIdx = activePath.findIndex((n) => n.id === id);
    if (existingIdx !== -1 && existingIdx <= currentIdx) {
      // Node is already passed — don't do anything
      return;
    }

    // Trace path from root to the target node (BFS shortest path through the graph)
    const pathEdges: GraphEdge[] = [];
    let curr = id;
    let safeguard = 1000;
    while (curr !== graph.root && safeguard > 0) {
      safeguard--;
      const incoming = graph.edges.find((e) => e.to === curr);
      if (!incoming) break;
      pathEdges.unshift(incoming);
      curr = incoming.from;
    }

    // Update branch choices to make this path active
    set((state) => {
      const choices = { ...state.branchChoices };
      for (const edge of pathEdges) {
        choices[edge.from] = edge.id;
      }
      return { branchChoices: choices };
    });

    get().refreshActivePath();
  },

  selectNode: (id) => set({ selectedNode: id, selectedEdge: null }),
  selectEdge: (id) => set({ selectedEdge: id, selectedNode: null }),
  toggleEditor: () => set((s) => ({ editorOpen: !s.editorOpen })),
  setMergeMode: (sourceId) => set({ mergeModeSource: sourceId }),

  // ── Discovery ───────────────────────────────────────────

  markVisited: (nodeId) => {
    set((state) => {
      const visited = new Set(state.visitedNodes);
      visited.add(nodeId);
      // Persist to localStorage
      try {
        localStorage.setItem("threadrift-visited", JSON.stringify([...visited]));
      } catch {
        /* ignore */
      }
      return { visitedNodes: visited };
    });
  },

  // ── Serialization ───────────────────────────────────────

  toJSON: () => {
    const { graph, nextNodeId } = get();
    return {
      version: "1.0",
      nextNodeId,
      root: graph.root,
      nodes: graph.nodes,
      edges: graph.edges,
    };
  },
});
