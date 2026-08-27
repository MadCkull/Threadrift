// ============================================================
// Threadrift — Spline & Bézier Mathematics
// ============================================================

import type { GraphEdge, GraphNode, Point, Sequence } from "./types";
import {
  SPLINE_CP_FACTOR,
  CATMULL_VIRTUAL_DISTANCE,
} from "./constants";

/**
 * Generate a cubic bézier path string using Catmull-Rom interpolation
 * between two points, given their neighbors for tangent computation.
 */
export function catmullSegment(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  tension = 1,
  curveStart = 0,
  curveEnd = 0
): string {
  let cp1x = p1.x + ((p2.x - p0.x) * tension) / 6;
  let cp1y = p1.y + ((p2.y - p0.y) * tension) / 6;
  let cp2x = p2.x - ((p3.x - p1.x) * tension) / 6;
  let cp2y = p2.y - ((p3.y - p1.y) * tension) / 6;

  if (curveStart !== 0 || curveEnd !== 0) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    
    if (curveStart !== 0) {
      const shift1 = curveStart * 150;
      cp1x += nx * shift1;
      cp1y += ny * shift1;
    }
    
    if (curveEnd !== 0) {
      const shift2 = curveEnd * 150;
      cp2x += nx * shift2;
      cp2y += ny * shift2;
    }
  }

  return `M ${p1.x} ${p1.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
}

/**
 * Compute SVG path `d` attribute for a given edge.
 *
 * - Main edges use Catmull-Rom splines through the parent sequence.
 * - Branch/merge edges use cubic bézier with divergence angle rotation and curve adjustment.
 */
export function edgePath(
  edge: GraphEdge,
  sequences: Sequence[],
  getNode: (id: number) => GraphNode | undefined
): string {
  const from = getNode(edge.from);
  const to = getNode(edge.to);
  if (!from || !to) return "";

  // Main edges: Catmull-Rom through sequence
  if (edge.type === "main") {
    const seq = sequences.find((s) => s.id === from.seqId);
    if (seq) {
      const idx = seq.nodes.findIndex((n) => n.id === from.id);
      if (idx !== -1 && seq.nodes[idx + 1]?.id === to.id) {
        let p0 = seq.nodes[idx - 1] as Point | undefined;
        const p1 = seq.nodes[idx];
        const p2 = seq.nodes[idx + 1];
        let p3 = seq.nodes[idx + 2] as Point | undefined;

        if (!p0) {
          p0 = {
            x: p1.x - (p1.vx ?? 0) * CATMULL_VIRTUAL_DISTANCE,
            y: p1.y - (p1.vy ?? 1) * CATMULL_VIRTUAL_DISTANCE,
          };
        }
        if (!p3) {
          p3 = {
            x: p2.x + (p2.vx ?? 0) * CATMULL_VIRTUAL_DISTANCE,
            y: p2.y + (p2.vy ?? 1) * CATMULL_VIRTUAL_DISTANCE,
          };
        }
        return catmullSegment(p0, p1, p2, p3, 1, edge.curve ?? 0, edge.curveEnd ?? 0);
      }
    }
  }

  // Branch/merge edges: Cubic bézier with divergence rotation
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const L = dist * SPLINE_CP_FACTOR;

  let vAx = from.vx ?? 0;
  let vAy = from.vy ?? 1;
  const vBx = to.vx ?? 0;
  const vBy = to.vy ?? 1;

  // Apply divergence angle rotation to the starting tangent
  const divAngle = (edge.diverge ?? 0) * Math.PI;
  const cosD = Math.cos(divAngle);
  const sinD = Math.sin(divAngle);
  const divVx = vAx * cosD - vAy * sinD;
  const divVy = vAx * sinD + vAy * cosD;

  // Apply curve bend
  const curveAngle = (edge.curve ?? 0) * (Math.PI / 3);
  const endCurveAngle = (edge.curveEnd ?? 0) * (Math.PI / 3);

  const sinA = Math.sin(curveAngle);
  const cosA = Math.cos(curveAngle);
  const cp1vx = divVx * cosA - divVy * sinA;
  const cp1vy = divVx * sinA + divVy * cosA;

  const sinB = Math.sin(-endCurveAngle);
  const cosB = Math.cos(-endCurveAngle);
  const cp2vx = vBx * cosB - vBy * sinB;
  const cp2vy = vBx * sinB + vBy * cosB;

  const cp1x = from.x + cp1vx * L;
  const cp1y = from.y + cp1vy * L;
  const cp2x = to.x - cp2vx * L;
  const cp2y = to.y - cp2vy * L;

  return `M ${from.x} ${from.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${to.x} ${to.y}`;
}
