import { getActivePath, type GraphData, type GraphEdge, type GraphNode } from "@threadrift/core";

interface NavigationState {
  graph: GraphData;
  activePath: GraphNode[];
  branchChoices: Record<number, string>;
  scrollTarget: number;
  scrollCurrent: number;
  isScrolling: boolean;
}

/** The animation loop hard-snaps both values; proximity is not complete rest. */
export function getRestingNodeIndex(state: Pick<NavigationState,
  "activePath" | "scrollTarget" | "scrollCurrent" | "isScrolling"
>): number | null {
  const { scrollTarget, scrollCurrent, isScrolling, activePath } = state;
  if (
    isScrolling ||
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

/** Resolve atomically so subscribers never see new choices with the old path. */
export function resolvePathSelection(state: NavigationState, branchChoices: Record<number, string>) {
  const restingIndex = getRestingNodeIndex(state);
  if (restingIndex === null) return null;
  const activePath = getActivePath(state.graph, branchChoices);
  if (state.activePath.slice(0, restingIndex + 1).some((node, i) => activePath[i]?.id !== node.id)) {
    return null;
  }
  return { branchChoices, activePath };
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
    // Clicking a node already on this route requires no path change.
    if (state.activePath.some((node) => node.id === target.nodeId)) return null;
    route = findForwardRoute(state, current.id, target.nodeId, blocked);
  } else {
    const edge = state.graph.edges.find((edge) => edge.id === target.edgeId);
    if (!edge || edge.to === current.id || blocked.has(edge.to)) return null;
    // Reach this edge's origin without first traversing its destination.
    blocked.add(edge.to);
    route = findForwardRoute(state, current.id, edge.from, blocked);
    if (route) route.push(edge);
  }
  if (!route?.length) return null;

  const branchChoices = { ...state.branchChoices };
  let changed = false;
  for (const edge of route) {
    const outgoing = state.graph.edges.filter((candidate) => candidate.from === edge.from);
    const selectedId = branchChoices[edge.from]
      ?? outgoing.find((candidate) => candidate.type === "main")?.id
      ?? (outgoing.length === 1 ? outgoing[0].id : undefined);
    if (selectedId !== edge.id) {
      branchChoices[edge.from] = edge.id;
      changed = true;
    }
  }
  return changed ? resolvePathSelection(state, branchChoices) : null;
}
