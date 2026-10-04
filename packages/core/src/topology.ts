// ============================================================
// Threadrift — Topology Engine
// ============================================================
//
// Computes hierarchy levels, sequences, tangent vectors,
// and the active navigation path through the Threadrift graph.
//

import type { GraphData, GraphEdge, GraphNode, Sequence } from "./types";

// ── Graph Query Helpers ─────────────────────────────────────

export function getNode(graph: GraphData, id: number): GraphNode | undefined {
  return graph.nodes[id];
}

export function getOutgoing(graph: GraphData, id: number): GraphEdge[] {
  return graph.edges.filter((e) => e.from === id);
}

export function getIncoming(graph: GraphData, id: number): GraphEdge | undefined {
  return graph.edges.find((e) => e.to === id);
}

export function getMainOutgoing(graph: GraphData, id: number): GraphEdge | undefined {
  return graph.edges.find((e) => e.from === id && e.type === "main");
}

// ── Active Path ─────────────────────────────────────────────

/**
 * Walk the graph from root, respecting explicit choices, author recommendations,
 * and then automatic continuation based on the route's actual incoming edge.
 */
export function getActivePath(
  graph: GraphData,
  branchChoices: Record<number, string>
): GraphNode[] {
  return getActiveRoute(graph, branchChoices).nodes;
}

export interface ActiveRoute {
  nodes: GraphNode[];
  /** Exact connections matter when parallel edges share the same endpoints. */
  edges: GraphEdge[];
}

/**
 * Author recommendation, or deterministic automatic continuation.
 *
 * Chords describe the overall direction of travel through a fork. Shared spline
 * endpoint tangents can make visibly different exits indistinguishable, and a
 * node's computed tangent can inherit another parent at a merge. Use the actual
 * incoming route edge instead: best heading alignment, shortest distance, edge ID.
 * At the root (no incoming heading), prefer main, then distance and edge ID.
 * This function does not record an explicit user choice.
 */
export function getRecommendedEdge(
  graph: GraphData,
  nodeId: number,
  incomingEdge?: GraphEdge
): GraphEdge | undefined {
  const node = getNode(graph, nodeId);
  if (!node) return undefined;
  const exits = getOutgoing(graph, nodeId).filter(edge => {
    const to = getNode(graph, edge.to);
    return to && Number.isFinite(Math.hypot(to.x - node.x, to.y - node.y)) &&
      Math.hypot(to.x - node.x, to.y - node.y) > 0;
  });
  const recommended = exits.find(edge => edge.id === node.recommendedEdgeId);
  if (recommended) return recommended;

  const previous = incomingEdge?.to === nodeId ? getNode(graph, incomingEdge.from) : undefined;
  const arrivalLength = previous ? Math.hypot(node.x - previous.x, node.y - previous.y) : 0;
  const hasHeading = Number.isFinite(arrivalLength) && arrivalLength > 0;
  const headingX = hasHeading ? (node.x - previous!.x) / arrivalLength : 0;
  const headingY = hasHeading ? (node.y - previous!.y) / arrivalLength : 0;
  const scored = exits.map(edge => {
    const to = getNode(graph, edge.to)!;
    const dx = to.x - node.x;
    const dy = to.y - node.y;
    const distance = Math.hypot(dx, dy);
    // Quantization gives near-identical headings a transitive, order-independent tie.
    const alignment = hasHeading ? Math.round(((dx / distance) * headingX + (dy / distance) * headingY) * 1e9) / 1e9 : 0;
    return { edge, distance, alignment };
  });
  scored.sort((a, b) => {
    if (hasHeading && a.alignment !== b.alignment) return b.alignment - a.alignment;
    if (!hasHeading && a.edge.type !== b.edge.type) return a.edge.type === "main" ? -1 : 1;
    if (a.distance !== b.distance) return a.distance - b.distance;
    return a.edge.id < b.edge.id ? -1 : a.edge.id > b.edge.id ? 1 : 0;
  });
  return scored[0]?.edge;
}

export function getActiveRoute(
  graph: GraphData,
  branchChoices: Record<number, string>
): ActiveRoute {
  const result: ActiveRoute = { nodes: [], edges: [] };
  const seen = new Set<number>();
  let curr: number | undefined = graph.root;

  while (curr !== undefined) {
    const node = getNode(graph, curr);
    if (!node || seen.has(curr)) break;
    seen.add(curr);
    result.nodes.push(node);

    let nextEdge: GraphEdge | undefined;
    const choice = branchChoices[curr];
    if (choice) {
      nextEdge = graph.edges.find((e) => e.id === choice && e.from === curr);
    }
    if (!nextEdge) nextEdge = getRecommendedEdge(graph, curr, result.edges[result.edges.length - 1]);

    if (!nextEdge || !getNode(graph, nextEdge.to) || seen.has(nextEdge.to)) break;
    result.edges.push(nextEdge);
    curr = nextEdge.to;
  }

  return result;
}

// ── Full Topology Computation ───────────────────────────────

export interface TopologyResult {
  sequences: Sequence[];
}

/**
 * Compute the full topology of the graph:
 * - Assigns hierarchy levels to every node
 * - Groups nodes into sequences (continuous main-edge chains)
 * - Computes tangent vectors for spline rendering
 * - Inherits parent tangents for branch origins
 *
 * This mutates node properties (level, seqId, parentSeqId, vx, vy).
 */
export function computeTopology(graph: GraphData): TopologyResult {
  // Reset computed properties
  Object.values(graph.nodes).forEach((n) => {
    n.level = undefined;
    n.seqId = null;
    n.parentSeqId = null;
  });

  let seqCounter = 0;

  function traverse(
    nodeId: number,
    currentLevel: number,
    currentSeqId: number,
    parentSeqId: number | null
  ) {
    // Iterative depth-first traversal also handles long imported chains safely.
    const pending = [{ nodeId, currentLevel, currentSeqId, parentSeqId }];
    while (pending.length) {
      const item = pending.pop()!;
      const node = getNode(graph, item.nodeId);
      if (!node || node.seqId !== null) continue;
      node.level = item.currentLevel;
      node.seqId = item.currentSeqId;
      node.parentSeqId = item.parentSeqId;
      const children = getOutgoing(graph, node.id).map((edge) => edge.type === "main"
        ? { ...item, nodeId: edge.to }
        : { nodeId: edge.to, currentLevel: item.currentLevel + 1,
            currentSeqId: ++seqCounter, parentSeqId: item.currentSeqId });
      pending.push(...children.reverse());
    }
  }

  // Traverse from root
  traverse(graph.root, 1, 0, null);

  // Handle disconnected components
  Object.values(graph.nodes).forEach((n) => {
    if (n.level === undefined) {
      seqCounter++;
      traverse(n.id, 1, seqCounter, null);
    }
  });

  // Build sequence objects
  const seqMap: Record<number, Sequence> = {};
  const sequences: Sequence[] = [];

  Object.values(graph.nodes).forEach((n) => {
    const sid = n.seqId ?? -1;
    if (!seqMap[sid]) {
      seqMap[sid] = {
        id: sid,
        level: n.level ?? 1,
        parentSeqId: n.parentSeqId ?? null,
        nodes: [],
      };
      sequences.push(seqMap[sid]);
    }
  });

  // Sort nodes within each sequence by following main edges
  sequences.forEach((seq) => {
    const seqNodes = Object.values(graph.nodes).filter((n) => n.seqId === seq.id);
    let startNode = seqNodes.find((n) => {
      const incoming = getIncoming(graph, n.id);
      return !incoming || incoming.type !== "main";
    });
    if (!startNode) startNode = seqNodes[0];

    const sorted: GraphNode[] = [];
    let curr = startNode;
    while (curr) {
      sorted.push(curr);
      const outMain = getMainOutgoing(graph, curr.id);
      const next = outMain ? getNode(graph, outMain.to) : undefined;
      if (!next || next.seqId !== seq.id || sorted.includes(next)) break;
      curr = next;
    }
    seq.nodes = sorted;
  });

  // Compute tangent vectors using finite differences
  Object.values(graph.nodes).forEach((n) => {
    n.vx = 0;
    n.vy = 1;
  });

  sequences.forEach((seq) => {
    const arr = seq.nodes;
    for (let i = 0; i < arr.length; i++) {
      let prev = arr[i - 1] as { x: number; y: number } | undefined;
      let next = arr[i + 1] as { x: number; y: number } | undefined;

      if (!prev && next) {
        prev = {
          x: arr[i].x - (next.x - arr[i].x),
          y: arr[i].y - (next.y - arr[i].y),
        };
      }
      if (!next && prev) {
        next = {
          x: arr[i].x + (arr[i].x - prev.x),
          y: arr[i].y + (arr[i].y - prev.y),
        };
      }
      if (!prev && !next) {
        prev = { x: arr[i].x, y: arr[i].y - 10 };
        next = { x: arr[i].x, y: arr[i].y + 10 };
      }

      const dx = next!.x - prev!.x;
      const dy = next!.y - prev!.y;
      const len = Math.hypot(dx, dy) || 1;
      arr[i].vx = dx / len;
      arr[i].vy = dy / len;
    }
  });

  // Inherit parent tangent for branch start nodes
  sequences.forEach((seq) => {
    if (seq.level > 1 && seq.nodes.length > 0) {
      const firstNode = seq.nodes[0];
      const incoming = getIncoming(graph, firstNode.id);
      if (incoming?.type === "branch") {
        const parent = getNode(graph, incoming.from);
        if (parent?.vx !== undefined && parent?.vy !== undefined) {
          firstNode.vx = parent.vx;
          firstNode.vy = parent.vy;
        }
      }
    }
  });

  return { sequences };
}
