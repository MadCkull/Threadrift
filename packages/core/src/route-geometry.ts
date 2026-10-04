import type { GraphData, GraphNode, Point, Sequence } from "./types";
import type { ActiveRoute } from "./topology";
import { edgePath } from "./spline";
import { getPathLength, getPointAtFraction } from "./path-math";
import { MIN_TRAVEL_LENGTH } from "./validation";

export interface RouteGeometryEdge {
  id: string;
  from: number;
  to: number;
  d: string;
  length: number;
  startDistance: number;
  endDistance: number;
}

export interface RouteGeometry {
  nodes: GraphNode[];
  edges: RouteGeometryEdge[];
  nodeDistances: number[];
  totalLength: number;
}

/** Rebuild when the graph or selected route changes; sampling needs no browser DOM. */
export function createRouteGeometry(graph: GraphData, sequences: Sequence[], route: ActiveRoute): RouteGeometry {
  const edges: RouteGeometryEdge[] = [];
  const nodeDistances = route.nodes.length ? [0] : [];
  let totalLength = 0;
  if (route.edges.length !== Math.max(0, route.nodes.length - 1)) throw new Error("Route nodes and edges must form one continuous path");
  route.edges.forEach((edge, index) => {
    if (edge.from !== route.nodes[index].id || edge.to !== route.nodes[index + 1].id) throw new Error(`Route edge ${edge.id} has mismatched endpoints`);
    const d = edgePath(edge, sequences, (id) => graph.nodes[id]);
    const length = getPathLength(edge.id, d);
    if (!Number.isFinite(length) || length <= MIN_TRAVEL_LENGTH) throw new Error(`Edge ${edge.id} has invalid or zero-length spline geometry`);
    const startDistance = totalLength;
    totalLength += length;
    if (!Number.isFinite(totalLength)) throw new Error("Route length exceeds finite geometry bounds");
    edges.push({ id: edge.id, from: edge.from, to: edge.to, d, length, startDistance, endDistance: totalLength });
    nodeDistances.push(totalLength);
  });
  return { nodes: route.nodes, edges, nodeDistances, totalLength };
}

const clamp = (value: number, max: number) => Math.max(0, Math.min(max, Number.isNaN(value) ? 0 : value));

/** Legacy fractional progress is the arc-length fraction of its selected edge. */
export function progressToDistance(geometry: RouteGeometry, progress: number): number {
  const p = clamp(progress, geometry.edges.length);
  const index = Math.floor(p);
  if (index === geometry.edges.length) return geometry.totalLength;
  const edge = geometry.edges[index];
  return edge.startDistance + (p - index) * edge.length;
}

export function distanceToProgress(geometry: RouteGeometry, distance: number): number {
  const d = clamp(distance, geometry.totalLength);
  if (d === geometry.totalLength) return geometry.edges.length;
  let lo = 0, hi = geometry.edges.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (geometry.edges[mid].endDistance <= d) lo = mid + 1;
    else hi = mid;
  }
  const edge = geometry.edges[lo];
  return edge ? lo + (d - edge.startDistance) / edge.length : 0;
}

export interface RouteSample extends Point {
  edgeId?: string;
  fraction: number;
  distance: number;
}

export function sampleRoute(geometry: RouteGeometry, progress: number): RouteSample {
  const p = clamp(progress, geometry.edges.length);
  const index = Math.floor(p);
  const fraction = p - index;
  const distance = progressToDistance(geometry, p);
  const node = geometry.nodes[index];
  const edge = geometry.edges[index];
  // Exact nodes avoid accumulating numerical endpoint error in camera/rest state.
  if (fraction === 0 || !edge) return { x: node?.x ?? 0, y: node?.y ?? 0, edgeId: edge?.id, fraction: 0, distance };
  return { ...getPointAtFraction(edge.id, edge.d, fraction), edgeId: edge.id, fraction, distance };
}
