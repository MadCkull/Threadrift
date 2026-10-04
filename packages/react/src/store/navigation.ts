import { getActiveRoute, type GraphData, type GraphEdge, type GraphNode } from "@threadrift/core";

interface NavigationState {
  graph: GraphData;
  activePath: GraphNode[];
  branchChoices: Record<number, string>;
  scrollTarget: number;
  scrollCurrent: number;
  isScrolling: boolean;
  editorOpen?: boolean;
  inputSession?: unknown;
  cameraOverride?: unknown;
  cameraReturn?: unknown;
  activeEdges?: GraphEdge[];
}

/** The animation loop hard-snaps both values; proximity is not complete rest. */
export function getRestingNodeIndex(state: Pick<NavigationState,
  "activePath" | "scrollTarget" | "scrollCurrent" | "isScrolling" | "editorOpen" | "inputSession" | "cameraOverride" | "cameraReturn"
>): number | null {
  const { scrollTarget, scrollCurrent, isScrolling, activePath } = state;
  if (
    isScrolling || state.editorOpen || state.inputSession || state.cameraOverride || state.cameraReturn ||
    !Number.isInteger(scrollTarget) ||
    scrollCurrent !== scrollTarget ||
    scrollTarget < 0 ||
    scrollTarget >= activePath.length
  ) return null;
  return scrollTarget;
}

/** Search downstream only; never route through the already-travelled prefix. */
function findForwardRoute(
  state: NavigationState,
  startId: number,
  targetId: number,
  blocked: Set<number>
): GraphEdge[] | null {
  if (!state.graph.nodes[targetId] || blocked.has(targetId)) return null;
  const queue = [startId];
  const visited = new Set([startId]);
  const incoming = new Map<number, GraphEdge>();

  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    if (id === targetId) {
      const route: GraphEdge[] = [];
      let current = targetId;
      while (current !== startId) {
        const edge = incoming.get(current)!;
        route.push(edge);
        current = edge.from;
      }
      return route.reverse();
    }

    const outgoing = state.graph.edges.filter((edge) => edge.from === id);
    // Prefer the current continuation when equally short merge routes exist.
    const preferred = state.branchChoices[id]
      ?? outgoing.find((edge) => edge.type === "main")?.id;
    outgoing.sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred));
    for (const edge of outgoing) {
      if (blocked.has(edge.to) || visited.has(edge.to) || !state.graph.nodes[edge.to]) continue;
      visited.add(edge.to);
      incoming.set(edge.to, edge);
      queue.push(edge.to);
    }
  }
  return null;
}

/** Keep the longest already-planned continuation that can still reach the request. */
function findPreferredForwardRoute(state: NavigationState, restingIndex: number, targetId: number, blocked: Set<number>) {
  const edges = state.activeEdges ?? getActiveRoute(state.graph, state.branchChoices).edges;
  const incoming = new Map<number, number[]>();
  for (const edge of state.graph.edges) {
    if (blocked.has(edge.from) || blocked.has(edge.to)) continue;
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge.from]);
  }
  const ancestors = new Set<number>();
  const queue = [targetId];
  for (let i = 0; i < queue.length; i++) {
    if (ancestors.has(queue[i])) continue;
    ancestors.add(queue[i]);
    queue.push(...(incoming.get(queue[i]) ?? []));
  }
  for (let i = state.activePath.length - 1; i >= restingIndex; i--) {
    const origin = state.activePath[i].id;
    if (!ancestors.has(origin)) continue;
    const prefix = edges.slice(restingIndex, i);
    if (prefix.some((edge) => blocked.has(edge.to))) continue;
    const avoid = new Set([...blocked, ...state.activePath.slice(0, i).map((node) => node.id)]);
    const suffix = findForwardRoute(state, origin, targetId, avoid);
    if (suffix) return [...prefix, ...suffix];
  }
  return null;
}

/** Resolve atomically so subscribers never see new choices with the old path. */
export function resolvePathSelection(state: NavigationState, branchChoices: Record<number, string>) {
  const restingIndex = getRestingNodeIndex(state);
  if (restingIndex === null) return null;
  const { nodes: activePath, edges: activeEdges } = getActiveRoute(state.graph, branchChoices);
  if (state.activePath.slice(0, restingIndex + 1).some((node, i) => activePath[i]?.id !== node.id)) {
    return null;
  }
  const previousEdges = state.activeEdges ?? getActiveRoute(state.graph, state.branchChoices).edges;
  if (previousEdges.slice(0, restingIndex).some((edge, i) => activeEdges[i]?.id !== edge.id)) return null;
  // Drop plans on abandoned branches, keeping valid downstream choices on this route.
  const ids = new Set(activePath.map((node) => node.id));
  branchChoices = Object.fromEntries(Object.entries(branchChoices).filter(([id]) => ids.has(Number(id))));
  return { branchChoices, activePath, activeEdges };
}

export function selectForwardPath(
  state: NavigationState,
  target: { nodeId: number } | { edgeId: string }
) {
  const restingIndex = getRestingNodeIndex(state);
  if (restingIndex === null) return null;

  const current = state.activePath[restingIndex];
  const blocked = new Set(state.activePath.slice(0, restingIndex).map((node) => node.id));
  let route: GraphEdge[] | null;
  if ("nodeId" in target) {
    const existingIndex = state.activePath.findIndex((node) => node.id === target.nodeId);
    if (existingIndex >= 0 && existingIndex <= restingIndex) return null;
    // Confirm the visible continuation, including its exact parallel edge identity.
    route = existingIndex > restingIndex
      ? (state.activeEdges ?? getActiveRoute(state.graph, state.branchChoices).edges).slice(restingIndex, existingIndex)
      : findPreferredForwardRoute(state, restingIndex, target.nodeId, blocked);
  } else {
    const edge = state.graph.edges.find((edge) => edge.id === target.edgeId);
    if (!edge || edge.to === current.id || blocked.has(edge.to)) return null;
    // Reach this edge's origin without first traversing its destination.
    blocked.add(edge.to);
    const originIndex = state.activePath.findIndex((node) => node.id === edge.from);
    route = originIndex >= restingIndex
      ? (state.activeEdges ?? getActiveRoute(state.graph, state.branchChoices).edges).slice(restingIndex, originIndex)
      : findPreferredForwardRoute(state, restingIndex, edge.from, blocked);
    if (route?.some((item) => item.to === edge.to)) return null;
    if (route) route.push(edge);
  }
  if (!route?.length) return null;

  const branchChoices = { ...state.branchChoices };
  let changed = false;
  for (const edge of route) {
    const selectedId = branchChoices[edge.from];
    if (selectedId !== edge.id) {
      branchChoices[edge.from] = edge.id;
      changed = true;
    }
  }
  return changed ? resolvePathSelection(state, branchChoices) : null;
}
