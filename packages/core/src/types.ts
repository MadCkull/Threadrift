// ============================================================
// Threadrift — TypeScript Interfaces
// ============================================================

/** A single node in the Threadrift graph */
export interface GraphNode {
  extensions?: JsonObject;
  id: number;
  name: string;
  content: string;
  x: number;
  y: number;

  /** Fixed world-space viewport center on arrival. Absent means follow this node. */
  camera?: Point;

  /** Optional author-selected default exit. Omit to choose a continuation geometrically. */
  recommendedEdgeId?: string;

  // Computed at runtime by topology engine (not persisted)
  level?: number;
  seqId?: number | null;
  parentSeqId?: number | null;
  vx?: number;
  vy?: number;
  anchorX?: number;
  anchorY?: number;
  /** Content layout width in CSS pixels; height remains intrinsic. */
  anchorWidth?: number;
  /** @deprecated Accepted only by legacy v1/v2 imports; removed during migration. */
  anchorScale?: number;
}

/** An edge connecting two nodes in Threadrift */
export interface GraphEdge {
  extensions?: JsonObject;
  id: string;
  from: number;
  to: number;
  type: "main" | "branch";
  curve: number;
  curveEnd?: number;
  diverge?: number;
  /** Camera travel along this edge; progress remains graph arc-length based. */
  camera?: CameraTransition;
}

export interface CameraTransition {
  mode: "path" | "direct";
  /** Fractions of edge travel. Outside this window the view holds at an endpoint. */
  start: number;
  end: number;
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
  settings?: { physics?: Partial<PhysicsSettings>; editor?: Partial<DocumentSettings["editor"]>; extensions?: JsonObject };
  extensions?: JsonObject;
}

export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export interface JsonObject { [key: string]: JsonValue }

export interface PhysicsSettings {
  scrollSensitivity: number;
  touchSensitivity: number;
  snapStrength: number;
  snapThreshold: number;
}

export interface DocumentSettings {
  physics: PhysicsSettings;
  editor: { autoSaveEnabled: boolean };
  extensions?: JsonObject;
}

/** Canonical durable document. Runtime topology and navigation never belong here. */
export type DocumentNode = Omit<GraphNode, "level" | "seqId" | "parentSeqId" | "vx" | "vy" | "anchorScale">;
export interface GraphDocument extends GraphJSON {
  version: "4.0";
  nodes: Record<string, DocumentNode>;
  settings: DocumentSettings;
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
