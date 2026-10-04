import type { DocumentSettings, GraphData, GraphDocument, GraphEdge, GraphNode, JsonObject, JsonValue } from "./types";
import { GraphValidationError, validateGraphJSON } from "./validation";
import { COMPUTED_NODE_FIELDS, DEFAULT_DOCUMENT_SETTINGS, EDGE_FIELDS, isPlainObject, NODE_FIELDS } from "./document-schema";
import { computeTopology } from "./topology";
import { createRouteGeometry } from "./route-geometry";
export { DEFAULT_ANCHOR, DEFAULT_DOCUMENT_SETTINGS, PHYSICS_BOUNDS } from "./document-schema";

/** Clone JSON without stringify's silent coercion, dropped properties, or prototype hooks. */
function cloneJSON(value: unknown, path: string, ancestors = new Set<object>()): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || value === null) throw new GraphValidationError([`${path} must contain only finite JSON values`]);
  if (ancestors.has(value)) throw new GraphValidationError([`${path} contains a cycle`]);
  if (ancestors.size >= 128) throw new GraphValidationError([`${path} exceeds the supported JSON nesting depth (128)`]);
  if (!Array.isArray(value) && !isPlainObject(value)) throw new GraphValidationError([`${path} must contain only plain JSON objects`]);
  ancestors.add(value);
  const result: JsonValue[] | JsonObject = Array.isArray(value) ? [] : {};
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === "length") continue;
    if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key)) throw new GraphValidationError([`${path}.${String(key)} is not a safe JSON property`]);
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!descriptor.enumerable || descriptor.get || descriptor.set) throw new GraphValidationError([`${path}.${key} must be an enumerable data property`]);
    if (Array.isArray(value) && !/^(0|[1-9]\d*)$/.test(key)) throw new GraphValidationError([`${path}.${key} is not an array index`]);
    (result as JsonObject)[key] = cloneJSON(descriptor.value, `${path}.${key}`, ancestors);
  }
  if (Array.isArray(value) && Object.keys(value).length !== value.length) throw new GraphValidationError([`${path} must not contain sparse array entries`]);
  ancestors.delete(value);
  return result;
}

function assertExtensionObjects(value: Record<string, unknown>): void {
  const places: [string, unknown][] = [["document", value], ["settings", value.settings]];
  if (isPlainObject(value.nodes)) for (const [id, node] of Object.entries(value.nodes)) places.push([`node ${id}`, node]);
  if (Array.isArray(value.edges)) value.edges.forEach((edge, index) => places.push([`edge ${index}`, edge]));
  for (const [path, item] of places) if (isPlainObject(item) && item.extensions !== undefined && !isPlainObject(item.extensions)) throw new GraphValidationError([`${path}.extensions must be a plain object keyed by application namespace`]);
}

/** Parse v1/v2/v3/v4 input, migrate missing defaults and produce a detached canonical v4 document. */
export function parseGraphDocument(input: unknown): GraphDocument {
  // Inspect descriptors and JSON purity before graph validation can read user-supplied properties.
  const cloned = cloneJSON(input, "document") as unknown;
  const validated = validateGraphJSON(cloned);
  assertExtensionObjects(validated as unknown as Record<string, unknown>);
  const nodes = Object.fromEntries(Object.entries(validated.nodes).map(([key, node]) => {
    const clean = { ...node };
    delete clean.anchorScale;
    for (const field of COMPUTED_NODE_FIELDS) delete clean[field];
    return [key, clean];
  }));
  const result: GraphDocument = {
    version: "4.0", nextNodeId: validated.nextNodeId, root: validated.root,
    nodes, edges: validated.edges,
    settings: {
      physics: { ...DEFAULT_DOCUMENT_SETTINGS.physics, ...validated.settings?.physics },
      editor: { ...DEFAULT_DOCUMENT_SETTINGS.editor, ...validated.settings?.editor },
      ...(validated.settings?.extensions !== undefined ? { extensions: validated.settings.extensions } : {}),
    },
    ...(validated.extensions !== undefined ? { extensions: validated.extensions } : {}),
  };
  // Geometry preparation mutates topology, so validate on a separate clone, including inactive edges.
  const graph = cloneJSON({ nodes: result.nodes, edges: result.edges, root: result.root }, "graph") as unknown as GraphData;
  try {
    const { sequences } = computeTopology(graph);
    for (const edge of graph.edges) createRouteGeometry(graph, sequences, { nodes: [graph.nodes[edge.from], graph.nodes[edge.to]], edges: [edge] });
  } catch (error) {
    throw new GraphValidationError([`derived geometry is invalid: ${error instanceof Error ? error.message : String(error)}`]);
  }
  return result;
}

/** Serialize only durable fields and detach every nested value from live editor state. */
export function serializeGraphDocument(input: { graph: GraphData; nextNodeId: number; settings: DocumentSettings; extensions?: JsonObject }): GraphDocument {
  const project = (value: GraphNode | GraphEdge, allowed: readonly string[], computed: readonly string[] = []) => {
    const result: Record<string, unknown> = {};
    if (!isPlainObject(value)) throw new GraphValidationError(["runtime graph elements must be plain objects"]);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === "string" && computed.includes(key)) continue;
      if (typeof key !== "string" || !allowed.includes(key)) throw new GraphValidationError([`unsupported graph property ${String(key)}; put custom data in extensions`]);
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (descriptor.get || descriptor.set || !descriptor.enumerable) throw new GraphValidationError([`${String(key)} must be an enumerable data property`]);
      // Optional fields cleared by store actions are omitted; extension values remain strictly JSON.
      if (descriptor.value !== undefined) result[key] = descriptor.value;
    }
    return result;
  };
  return parseGraphDocument({
    version: "4.0", nextNodeId: input.nextNodeId, root: input.graph.root,
    nodes: Object.fromEntries(Object.entries(input.graph.nodes).map(([id, node]) => [id, project(node, NODE_FIELDS, COMPUTED_NODE_FIELDS)])),
    edges: input.graph.edges.map(edge => project(edge, EDGE_FIELDS)), settings: input.settings,
    ...(input.extensions !== undefined ? { extensions: input.extensions } : {}),
  });
}
