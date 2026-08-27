// ============================================================
// Threadrift — Topology Engine
// ============================================================
//
// Computes hierarchy levels, sequences, tangent vectors,
// and the active navigation path through the Threadrift graph.
//

import type { GraphData, GraphEdge, GraphNode, Sequence } from "./types";
import { CATMULL_VIRTUAL_DISTANCE } from "./constants";

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
 * Walk the graph from root following main edges,
 * respecting branch choices made by the user.
 */
export function getActivePath(
  graph: GraphData,
  branchChoices: Record<number, string>
): GraphNode[] {
  const result: GraphNode[] = [];
  let curr: number | undefined = graph.root;

  while (curr !== undefined) {
    const node = getNode(graph, curr);
    if (!node) break;
    result.push(node);

    let nextEdge: GraphEdge | undefined;
    const choice = branchChoices[curr];
    if (choice) {
      nextEdge = graph.edges.find((e) => e.id === choice);
    }
    if (!nextEdge) {
      nextEdge = getMainOutgoing(graph, curr);
    }
    // Auto-follow if there is exactly ONE outgoing branch (e.g. a merge edge)
    if (!nextEdge) {
      const allOutgoing = getOutgoing(graph, curr);
      if (allOutgoing.length === 1) {
        nextEdge = allOutgoing[0];
      }
    }

    curr = nextEdge ? nextEdge.to : undefined;
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
    const node = getNode(graph, nodeId);
    if (!node || node.seqId !== null) return;

    node.level = currentLevel;
    node.seqId = currentSeqId;
    node.parentSeqId = parentSeqId;

    const outgoing = getOutgoing(graph, node.id);
    outgoing.forEach((edge) => {
      if (edge.type === "main") {
        traverse(edge.to, currentLevel, currentSeqId, parentSeqId);
      } else {
        seqCounter++;
        traverse(edge.to, currentLevel + 1, seqCounter, currentSeqId);
      }
    });
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
      if (!next || sorted.includes(next)) break;
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
