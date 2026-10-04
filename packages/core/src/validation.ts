import type { GraphData, GraphJSON, GraphNode } from "./types";
import { documentShapeIssues } from "./document-schema";

/** Below one millionth of a graph unit there is no useful navigable segment. */
export const MIN_TRAVEL_LENGTH = 1e-6;

export class GraphValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid Threadrift graph: ${issues.join("; ")}`);
    this.name = "GraphValidationError";
  }
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const id = (value: unknown): value is number => finite(value) && Number.isSafeInteger(value) && value >= 0;

/** Validate without mutating input; disconnected components and parallel edges are supported. */
export function validateGraphData(value: unknown): GraphData {
  const issues: string[] = [];
  if (!record(value)) throw new GraphValidationError(["graph must be an object"]);
  if (!record(value.nodes)) issues.push("nodes must be an object keyed by node ID");
  if (!Array.isArray(value.edges)) issues.push("edges must be an array");
  if (issues.length) throw new GraphValidationError(issues);

  const nodes = value.nodes as Record<string, unknown>;
  const edges = value.edges as unknown[];
  const nodeIds = new Set<number>();
  for (const [key, node] of Object.entries(nodes)) {
    if (!record(node)) { issues.push(`node ${key} must be an object`); continue; }
    if (!id(node.id) || String(node.id) !== key) issues.push(`node ${key} must have a matching nonnegative safe integer ID`);
    if (id(node.id)) {
      if (nodeIds.has(node.id)) issues.push(`duplicate node ID ${node.id}`);
      nodeIds.add(node.id);
    }
    if (typeof node.name !== "string" || typeof node.content !== "string") issues.push(`node ${key} needs string name and content`);
    if (!finite(node.x) || !finite(node.y)) issues.push(`node ${key} coordinates must be finite`);
    for (const field of ["anchorX", "anchorY", "anchorWidth", "anchorScale"]) {
      if (node[field] !== undefined && !finite(node[field])) issues.push(`node ${key}.${field} must be finite`);
    }
    if (finite(node.anchorWidth) && node.anchorWidth <= 0) issues.push(`node ${key}.anchorWidth must be positive`);
    if (finite(node.anchorScale) && node.anchorScale <= 0) issues.push(`node ${key}.anchorScale must be positive`);
  }
  if (!id(value.root) || !Object.hasOwn(nodes, String(value.root))) issues.push("root must identify an existing node");

  const edgeIds = new Set<string>();
  const outgoing = new Map<number, number[]>();
  const indegree = new Map<number, number>([...nodeIds].map((key) => [key, 0]));
  for (const [index, edge] of edges.entries()) {
    if (!record(edge)) { issues.push(`edge ${index} must be an object`); continue; }
    const label = typeof edge.id === "string" ? edge.id : String(index);
    if (typeof edge.id !== "string" || !edge.id.trim()) issues.push(`edge ${index} needs a nonempty string ID`);
    else {
      if (edgeIds.has(edge.id)) issues.push(`duplicate edge ID ${edge.id}`);
      edgeIds.add(edge.id);
    }
    if (edge.type !== "main" && edge.type !== "branch") issues.push(`edge ${label} type must be main or branch`);
    if (!finite(edge.curve)) issues.push(`edge ${label}.curve must be finite`);
    for (const field of ["curveEnd", "diverge"]) {
      if (edge[field] !== undefined && !finite(edge[field])) issues.push(`edge ${label}.${field} must be finite`);
    }
    if (!id(edge.from) || !id(edge.to) || !nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      issues.push(`edge ${label} endpoints must identify existing nodes`);
      continue;
    }
    const from = nodes[String(edge.from)] as GraphNode | undefined;
    const to = nodes[String(edge.to)] as GraphNode | undefined;
    if (from && to && finite(from.x) && finite(from.y) && finite(to.x) && finite(to.y)) {
      const distance = Math.hypot(to.x - from.x, to.y - from.y);
      if (!Number.isFinite(distance) || distance <= MIN_TRAVEL_LENGTH) issues.push(`edge ${label} must connect distinct finite positions (zero-length travel is unsupported)`);
    }
    const children = outgoing.get(edge.from) ?? [];
    children.push(edge.to);
    outgoing.set(edge.from, children);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }
  for (const [key, node] of Object.entries(nodes)) {
    if (!record(node) || node.recommendedEdgeId === undefined) continue;
    if (typeof node.recommendedEdgeId !== "string" || !node.recommendedEdgeId.trim() ||
      !edges.some(edge => record(edge) && edge.id === node.recommendedEdgeId && edge.from === node.id)) {
      issues.push(`node ${key}.recommendedEdgeId must identify an outgoing edge owned by this node`);
    }
  }
  // Kahn's algorithm includes disconnected components and counts parallel edges separately.
  const queue = [...indegree].filter(([, degree]) => degree === 0).map(([key]) => key);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    for (const child of outgoing.get(queue[cursor]) ?? []) {
      const degree = indegree.get(child)! - 1;
      indegree.set(child, degree);
      if (degree === 0) queue.push(child);
    }
  }
  if (queue.length !== nodeIds.size) issues.push("directed cycles are unsupported; remove the connection that loops back");
  if (issues.length) throw new GraphValidationError(issues);
  return value as unknown as GraphData;
}

export function validateGraphJSON(value: unknown): GraphJSON {
  const graph = validateGraphData(value);
  const data = value as Record<string, unknown>;
  const issues: string[] = documentShapeIssues(data);
  if (!id(data.nextNodeId) || Object.values(graph.nodes).some((node) => node.id >= (data.nextNodeId as number))) {
    issues.push("nextNodeId must be a safe integer greater than every existing node ID");
  }
  if (issues.length) throw new GraphValidationError(issues);
  return value as GraphJSON;
}
