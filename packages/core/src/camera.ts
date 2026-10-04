import type { CameraTransition, GraphNode, Point } from "./types";
import type { RouteGeometry } from "./route-geometry";
import { sampleRoute } from "./route-geometry";
import { isPlainObject } from "./document-schema";

/** Authored centers are bounded to keep browser projection and offset math usable. */
export const CAMERA_COORDINATE_LIMIT = 1e9;
function fields(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (!isPlainObject(value) || Reflect.ownKeys(value).length !== keys.length) return false;
  return keys.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return !!descriptor && descriptor.enumerable && "value" in descriptor;
  });
}
export function isCameraView(value: unknown): value is Point {
  return fields(value, ["x", "y"]) &&
    ["x", "y"].every(key => typeof value[key] === "number" && Number.isFinite(value[key]) && Math.abs(value[key] as number) <= CAMERA_COORDINATE_LIMIT);
}
export function isCameraTransition(value: unknown): value is CameraTransition {
  return fields(value, ["mode", "start", "end"]) &&
    (value.mode === "path" || value.mode === "direct") &&
    typeof value.start === "number" && typeof value.end === "number" &&
    Number.isFinite(value.start) && Number.isFinite(value.end) &&
    value.start >= 0 && value.end <= 1 && value.end - value.start >= .001;
}
export const nodeCamera = (node: GraphNode): Point => node.camera ?? { x: node.x, y: node.y };
export const mixPoint = (a: Point, b: Point, t: number): Point => ({ x: a.x * (1 - t) + b.x * t, y: a.y * (1 - t) + b.y * t });
export const smoothstep = (t: number) => t * t * (3 - 2 * t);

/** Pure, reversible camera sampling. Navigation and reveal still use sampleRoute. */
export function sampleCamera(geometry: RouteGeometry | null, progress: number): Point {
  if (!geometry?.nodes.length) return { x: 0, y: 0 };
  const p = Math.max(0, Math.min(geometry.edges.length, Number.isNaN(progress) ? 0 : progress));
  const index = Math.floor(p);
  const a = geometry.nodes[index];
  const edge = geometry.edges[index];
  const fraction = p - index;
  if (!edge || fraction === 0) return nodeCamera(a);
  const b = geometry.nodes[index + 1];
  const transition = edge.camera;
  if (!a.camera && !b.camera && !transition) {
    const { x, y } = sampleRoute(geometry, p);
    return { x, y };
  }
  const ca = nodeCamera(a), cb = nodeCamera(b);
  // Two deliberately equal saved views hold exactly, even on a curved path.
  if (a.camera && b.camera && ca.x === cb.x && ca.y === cb.y) return { ...ca };
  const start = transition?.start ?? 0, end = transition?.end ?? 1;
  if (fraction <= start) return { ...ca };
  if (fraction >= end) return { ...cb };
  const t = (fraction - start) / (end - start);
  const weight = smoothstep(t);
  if (transition?.mode === "direct") return mixPoint(ca, cb, weight);
  const path = sampleRoute(geometry, index + t);
  const offset = mixPoint({ x: ca.x - a.x, y: ca.y - a.y }, { x: cb.x - b.x, y: cb.y - b.y }, weight);
  const result = { x: path.x + offset.x, y: path.y + offset.y };
  if (!Number.isFinite(result.x) || !Number.isFinite(result.y)) throw new Error("Camera projection exceeds finite bounds");
  return result;
}
