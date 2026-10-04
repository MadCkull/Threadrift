import { CAMERA_SCALE, CANVAS_SIZE, edgePath, type GraphData, type Point, type Sequence } from "@threadrift/core";
export interface Bounds { left: number; right: number; top: number; bottom: number }
export function viewBounds(center: Point, width: number, height: number): Bounds {
  const scale = Math.max(1, width, height) / CANVAS_SIZE * CAMERA_SCALE;
  const x = width / scale / 2 + 160, y = height / scale / 2 + 160;
  return { left: center.x - x, right: center.x + x, top: center.y - y, bottom: center.y + y };
}
export function overlaps(a: Bounds, b: Bounds) {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}
/** Cubic curves stay inside their control-point hull. All generated edges are M/C. */
export function edgeBounds(graph: GraphData, sequences: Sequence[]) {
  return new Map(graph.edges.map(edge => {
    const numbers = edgePath(edge, sequences, id => graph.nodes[id]).match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];
    const xs = numbers.filter((_, i) => i % 2 === 0), ys = numbers.filter((_, i) => i % 2 === 1);
    return [edge.id, { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) }];
  }));
}
