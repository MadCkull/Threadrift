import { SCROLL_SENSITIVITY, TOUCH_SENSITIVITY, SNAP_STRENGTH, SNAP_THRESHOLD } from "./constants";
import type { DocumentSettings, PhysicsSettings } from "./types";

export const PHYSICS_BOUNDS: Readonly<Record<keyof PhysicsSettings, readonly [number, number]>> = Object.freeze({
  scrollSensitivity: Object.freeze([0.00001, 0.02] as const), touchSensitivity: Object.freeze([0.00001, 0.02] as const),
  snapStrength: Object.freeze([0, 1] as const), snapThreshold: Object.freeze([0, 0.5] as const),
});
export const DEFAULT_DOCUMENT_SETTINGS: Readonly<DocumentSettings> = Object.freeze({
  physics: Object.freeze({ scrollSensitivity: SCROLL_SENSITIVITY, touchSensitivity: TOUCH_SENSITIVITY,
    snapStrength: SNAP_STRENGTH, snapThreshold: SNAP_THRESHOLD }),
  editor: Object.freeze({ autoSaveEnabled: true }),
});

export const DEFAULT_ANCHOR = Object.freeze({ x: 24, y: 24, width: 320 });

export const NODE_FIELDS = ["id", "name", "content", "x", "y", "anchorX", "anchorY", "anchorWidth", "recommendedEdgeId", "extensions"] as const;
export const COMPUTED_NODE_FIELDS = ["level", "seqId", "parentSeqId", "vx", "vy"] as const;
export const EDGE_FIELDS = ["id", "from", "to", "type", "curve", "curveEnd", "diverge", "extensions"] as const;
export const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

/** Shared schema checks. Missing settings have documented defaults, invalid supplied values never do. */
export function documentShapeIssues(value: Record<string, unknown>): string[] {
  const issues: string[] = [];
  const fields = (object: unknown, allowed: readonly string[], path: string) => {
    if (!isPlainObject(object)) { issues.push(`${path} must be a plain object`); return; }
    for (const key of Reflect.ownKeys(object)) {
      if (typeof key !== "string" || !allowed.includes(key)) issues.push(`${path}.${String(key)} is not supported; put custom data in extensions`);
      const descriptor = Object.getOwnPropertyDescriptor(object, key)!;
      if (descriptor.get || descriptor.set) issues.push(`${path}.${String(key)} must be a data property`);
    }
  };
  fields(value, ["version", "root", "nextNodeId", "nodes", "edges", "settings", "extensions"], "document");
  if (value.version !== "1.0" && value.version !== "2.0" && value.version !== "3.0") issues.push(`unsupported document version ${String(value.version)}`);
  if (isPlainObject(value.nodes)) for (const [key, node] of Object.entries(value.nodes)) fields(node, [...NODE_FIELDS, ...COMPUTED_NODE_FIELDS, ...(value.version === "1.0" || value.version === "2.0" ? ["anchorScale"] : [])], `node ${key}`);
  if (Array.isArray(value.edges)) value.edges.forEach((edge, index) => fields(edge, EDGE_FIELDS, `edge ${index}`));
  if (value.settings !== undefined) {
    fields(value.settings, ["physics", "editor", "extensions"], "settings");
    if (isPlainObject(value.settings)) {
      const { physics, editor } = value.settings;
      if (physics !== undefined) {
        fields(physics, Object.keys(PHYSICS_BOUNDS), "settings.physics");
        if (isPlainObject(physics)) for (const [key, [min, max]] of Object.entries(PHYSICS_BOUNDS)) {
          const number = physics[key];
          if (number !== undefined && (typeof number !== "number" || !Number.isFinite(number) || number < min || number > max)) issues.push(`settings.physics.${key} must be finite and between ${min} and ${max}`);
        }
      }
      if (editor !== undefined) {
        fields(editor, ["autoSaveEnabled"], "settings.editor");
        if (isPlainObject(editor) && editor.autoSaveEnabled !== undefined && typeof editor.autoSaveEnabled !== "boolean") issues.push("settings.editor.autoSaveEnabled must be boolean");
      }
    }
  }
  return issues;
}
