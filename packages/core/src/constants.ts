// ============================================================
// Threadrift — Constants & Tuning Parameters
// ============================================================

/** Hierarchy level colors */
export const LEVEL_COLORS: Record<number, string> = {
  1: "#ffffff",   // Level 1: White
  2: "#38bdf8",   // Level 2: Sky Blue
  3: "#f43f5e",   // Level 3: Rose
  4: "#10b981",   // Level 4+: Emerald (fallback)
};

/** Get color for a given level, with fallback */
export function getLevelColor(level: number | undefined): string {
  return LEVEL_COLORS[level ?? 1] ?? LEVEL_COLORS[4];
}

// ── Navigation Physics ──────────────────────────────────────

/** Scroll sensitivity multiplier (lower = slower traversal) */
export const SCROLL_SENSITIVITY = 0.001;

/** Touch sensitivity multiplier (separate from wheel — touch is naturally more sensitive) */
export const TOUCH_SENSITIVITY = 0.003;

/** Minimum dot-product score to accept a branch switch gesture */
export const BRANCH_INTENT_THRESHOLD = 0.35;

/** How close to a node index before vector navigation activates */
export const FORK_DETECTION_RADIUS = 0.3;

/** Minimum scroll gesture magnitude to trigger branch detection */
export const MIN_GESTURE_MAGNITUDE = 8;

// ── Magnetic Snapping ───────────────────────────────────────

/** Distance threshold within which magnetic snap kicks in */
export const SNAP_THRESHOLD = 0.45;

/** Strength of the magnetic pull toward nearest node (0–1) */
export const SNAP_STRENGTH = 0.18;

/** Milliseconds after last scroll event before snap engages */
export const SCROLL_IDLE_TIMEOUT = 60;

/** Dead zone: movement below this magnitude is ignored when snapped to a node */
export const SNAP_DEAD_ZONE = 3;

// ── Camera ──────────────────────────────────────────────────

/** Lerp factor for camera interpolation (0–1, higher = snappier) */
export const CAMERA_LERP = 0.055;

/** Camera zoom scale */
export const CAMERA_SCALE = 1.08;

// ── Canvas ──────────────────────────────────────────────────

/** SVG viewBox dimensions */
export const CANVAS_SIZE = 1000;

/** Node core radius for root node */
export const ROOT_NODE_RADIUS = 6;

/** Node core radius for non-root nodes */
export const NODE_RADIUS = 4.5;

/** Hit-area radius for node pointer events */
export const NODE_HIT_RADIUS = 28;

/** Invisible hit-area stroke width for edges */
export const EDGE_HIT_WIDTH = 30;

// ── Labels ──────────────────────────────────────────────────

/** Distance threshold for showing node labels */
export const LABEL_SNAP_RADIUS = 0.25;

/** Label offset from node center */
export const LABEL_OFFSET = { x: 35, y: 5 };

// ── Spline ──────────────────────────────────────────────────

/** Control point length as fraction of edge distance */
export const SPLINE_CP_FACTOR = 0.45;

/** Virtual point distance for Catmull-Rom endpoints */
export const CATMULL_VIRTUAL_DISTANCE = 100;

// ── Audio ───────────────────────────────────────────────────

/** Whether audio is enabled by default */
export const AUDIO_ENABLED_DEFAULT = false;

// ── Max Depth ───────────────────────────────────────────────

/** Maximum branching depth allowed */
export const MAX_BRANCH_DEPTH = 3;

/** Distance beyond which nodes are unmounted to preserve memory */
export const CULLING_RADIUS = 800;

