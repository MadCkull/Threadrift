// ============================================================
// Threadrift — Path Math Engine
// ============================================================
//
// Calculates exact curve lengths and tangent vectors using
// svg-path-properties, with in-memory caching.
//

import { svgPathProperties } from "svg-path-properties";
import type { Point } from "./types";

type SvgPathPropertiesInstance = InstanceType<typeof svgPathProperties>;

/** In-memory cache of parsed path properties */
const pathCache = new Map<string, { d: string; props: SvgPathPropertiesInstance }>();

/**
 * Get or create a cached `svgPathProperties` instance for an edge.
 */
function getCachedProperties(edgeId: string, d: string): SvgPathPropertiesInstance {
  let entry = pathCache.get(edgeId);
  if (!entry || entry.d !== d) {
    entry = { d, props: new svgPathProperties(d) };
    // Bound cross-provider/long-running editor cache growth.
    if (pathCache.size >= 2048) pathCache.delete(pathCache.keys().next().value!);
    pathCache.set(edgeId, entry);
  }
  return entry.props;
}

/**
 * Invalidate cached properties for a specific edge (e.g. when curve changes).
 */
export function invalidatePathCache(edgeId: string): void {
  pathCache.delete(edgeId);
}

/**
 * Clear the entire path cache.
 */
export function clearPathCache(): void {
  pathCache.clear();
}

/**
 * Get the total length of an SVG path.
 */
export function getPathLength(edgeId: string, d: string): number {
  if (!d) return 0;
  return getCachedProperties(edgeId, d).getTotalLength();
}

/**
 * Get the 2D coordinates at a given fraction (0–1) along an edge path.
 */
export function getPointAtFraction(
  edgeId: string,
  d: string,
  fraction: number
): Point {
  if (!d) return { x: 0, y: 0 };
  const props = getCachedProperties(edgeId, d);
  const len = props.getTotalLength();
  const clamped = Math.max(0, Math.min(1, fraction));
  const pt = props.getPointAtLength(clamped * len);
  return { x: pt.x, y: pt.y };
}

/**
 * Get the tangent vector at a given fraction (0–1) along an edge path.
 */
export function getTangentAtFraction(
  edgeId: string,
  d: string,
  fraction: number
): Point {
  if (!d) return { x: 0, y: 1 };
  const props = getCachedProperties(edgeId, d);
  const len = props.getTotalLength();
  const targetDist = Math.max(0, Math.min(1, fraction)) * len;
  const delta = Math.min(1, len * 0.01);

  const p1 = props.getPointAtLength(Math.max(0, targetDist - delta));
  const p2 = props.getPointAtLength(Math.min(len, targetDist + delta));

  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const mag = Math.hypot(dx, dy) || 1;

  return { x: dx / mag, y: dy / mag };
}
