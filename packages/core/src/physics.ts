// ============================================================
// Threadrift — Physics & Vector Navigation Engine
// ============================================================

import type { GraphData, GraphNode, Point } from "./types";
import {
  BRANCH_INTENT_THRESHOLD,
  FORK_DETECTION_RADIUS,
  MIN_GESTURE_MAGNITUDE,
  SNAP_THRESHOLD,
  SNAP_STRENGTH,
} from "./constants";
import { getOutgoing, getNode } from "./topology";

/**
 * Result of branch intent detection.
 */
export interface BranchIntentResult {
  edgeId: string | null;
  score: number;
  type: "main" | "branch" | "none";
}

/**
 * Detect which branch the user intends to take based on scroll delta
 * and the physical direction of outgoing edges from the current node.
 */
export function detectBranchIntent(
  deltaX: number,
  deltaY: number,
  currentNode: GraphNode,
  graph: GraphData,
  currentBranchChoice?: string | null
): BranchIntentResult {
  const mag = Math.hypot(deltaX, deltaY);
  if (mag < MIN_GESTURE_MAGNITUDE) {
    return { edgeId: null, score: 0, type: "none" };
  }

  // Normalized gesture direction vector
  const gx = deltaX / mag;
  const gy = deltaY / mag;

  const outgoing = getOutgoing(graph, currentNode.id);
  if (outgoing.length <= 1) {
    return { edgeId: null, score: 0, type: "none" };
  }

  let bestEdge: string | null = null;
  let bestScore = -Infinity;
  let bestType: "main" | "branch" = "main";

  for (const edge of outgoing) {
    const targetNode = getNode(graph, edge.to);
    if (!targetNode) continue;

    // Vector from current node to target node
    const edx = targetNode.x - currentNode.x;
    const edy = targetNode.y - currentNode.y;
    const elen = Math.hypot(edx, edy) || 1;
    const ex = edx / elen;
    const ey = edy / elen;

    // Dot product: measures alignment between gesture and edge direction
    let dot = gx * ex + gy * ey;

    // Add stickiness to current path to prevent accidental direction changes
    // If this edge is the active choice, or (if no choice) it's the main edge, add a small bonus
    const isCurrentActive = currentBranchChoice 
      ? edge.id === currentBranchChoice 
      : edge.type === "main";
      
    if (isCurrentActive) {
      dot += 0.2; // Stickiness bonus
    }

    if (dot > bestScore) {
      bestScore = dot;
      bestEdge = edge.id;
      bestType = edge.type;
    }
  }

  if (bestScore >= BRANCH_INTENT_THRESHOLD && bestEdge) {
    return { edgeId: bestEdge, score: bestScore, type: bestType };
  }

  return { edgeId: null, score: bestScore, type: "none" };
}

/**
 * Check if the current scroll position is close enough to a node
 * to allow branch switching.
 */
export function isNearFork(scrollTarget: number): boolean {
  const nearest = Math.round(scrollTarget);
  return Math.abs(scrollTarget - nearest) < FORK_DETECTION_RADIUS;
}

/**
 * Get the nearest node index on the active path.
 */
export function getNearestNodeIndex(
  scrollProgress: number,
  pathLength: number
): number {
  return Math.max(0, Math.min(Math.round(scrollProgress), pathLength - 1));
}

/**
 * Apply magnetic snapping toward the nearest node when scroll is nearly stationary.
 * Uses strong pull that increases as you get closer, snapping exactly to center.
 */
export function applyMagneticSnap(
  target: number,
  threshold: number = SNAP_THRESHOLD,
  strength: number = SNAP_STRENGTH
): number {
  const nearest = Math.round(target);
  const dist = Math.abs(target - nearest);

  if (dist < threshold && dist > 0.0005) {
    // Strong exponential pull — the closer you are, the harder it pulls
    const pull = strength * (1 + (1 - dist / threshold) * 2);
    const snapped = target + (nearest - target) * pull;
    // If close enough, hard-snap to exact integer (no jitter)
    if (Math.abs(snapped - nearest) < 0.005) {
      return nearest;
    }
    return snapped;
  }
  // Hard snap if basically there
  if (dist <= 0.0005) {
    return nearest;
  }
  return target;
}

/**
 * Interpolate 2D position along the active path given a fractional index.
 */
export function interpolatePosition(
  activePath: GraphNode[],
  scrollCurrent: number
): Point {
  if (activePath.length === 0) return { x: 0, y: 0 };
  
  // Clamp negative scroll (Hero state) to the first node position
  if (scrollCurrent <= 0) {
    return { x: activePath[0].x, y: activePath[0].y };
  }

  const i = Math.floor(scrollCurrent);
  const frac = scrollCurrent - i;

  const current = activePath[Math.min(i, activePath.length - 1)];
  const next = activePath[Math.min(i + 1, activePath.length - 1)];

  if (!next || i >= activePath.length - 1) {
    return { x: current.x, y: current.y };
  }

  return {
    x: current.x + (next.x - current.x) * frac,
    y: current.y + (next.y - current.y) * frac,
  };
}
