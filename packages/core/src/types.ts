// ============================================================
// Threadrift — TypeScript Interfaces
// ============================================================

/** A single node in the Threadrift graph */
export interface GraphNode {
  id: number;
  name: string;
  content: string;
  x: number;
  y: number;

  // Computed at runtime by topology engine (not persisted)
  level?: number;
  seqId?: number | null;
  parentSeqId?: number | null;
  vx?: number;
  vy?: number;
  anchorX?: number;
  anchorY?: number;
  anchorScale?: number;
}

/** An edge connecting two nodes in Threadrift */
export interface GraphEdge {
  id: string;
  from: number;
  to: number;
  type: "main" | "branch";
  curve: number;
  curveEnd?: number;
  diverge?: number;
}

/** The full Threadrift graph data object */
export interface GraphData {
  nodes: Record<string, GraphNode>;
  edges: GraphEdge[];
  root: number;
}

/** The JSON file schema (what gets saved/loaded) */
export interface GraphJSON {
  version: string;
  nextNodeId: number;
  root: number;
  nodes: Record<string, GraphNode>;
  edges: GraphEdge[];
}

/** A sequence of nodes forming a continuous path */
export interface Sequence {
  id: number;
  level: number;
  parentSeqId: number | null;
  nodes: GraphNode[];
}

/** 2D point used in spline math */
export interface Point {
  x: number;
  y: number;
}

/** Camera state for the viewport */
export interface CameraState {
  x: number;
  y: number;
  scale: number;
}
