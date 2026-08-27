import { memo } from "react";
import type { GraphNode } from "@threadrift/core";
import {
  NODE_RADIUS,
  ROOT_NODE_RADIUS,
  NODE_HIT_RADIUS,
  getLevelColor,
} from "@threadrift/core";

interface GraphNodeProps {
  node: GraphNode;
  isActive: boolean;
  isVisited: boolean;
  isRoot: boolean;
  isSelected?: boolean;
  isMergeTarget?: boolean;
  onPointerDown?: (e: React.PointerEvent, nodeId: number) => void;
}

export const GraphNodeComponent = memo(function GraphNodeComponent({
  node,
  isActive,
  isVisited,
  isRoot,
  isSelected,
  isMergeTarget,
  onPointerDown,
}: GraphNodeProps) {
  const radius = isRoot ? ROOT_NODE_RADIUS : NODE_RADIUS;
  const color = getLevelColor(node.level);

  return (
    <g
      className={`node-group transition-opacity duration-300 ${
        !isVisited && !isActive && !isRoot ? "opacity-30" : "opacity-100"
      }`}
      transform={`translate(${node.x}, ${node.y})`}
    >
      {/* Selected Indicator */}
      {isSelected && !isMergeTarget && (
        <circle
          r={radius * 2.2}
          className="fill-none stroke-amber-400"
          strokeWidth={1.5}
          strokeDasharray="4 4"
        />
      )}

      {/* Merge Target Pulse */}
      {isMergeTarget && (
        <circle
          r={radius * 3}
          className="fill-none stroke-amber-500/40 animate-pulse"
          strokeWidth={1.5}
          strokeDasharray="4 3"
        />
      )}

      {/* Subtle glow when active */}
      {isActive && (
        <circle
          r={radius * 2}
          className="fill-current opacity-15"
          style={{ color, filter: "blur(3px)" }}
        />
      )}

      {/* Main node core */}
      <circle
        r={radius}
        className="transition-colors duration-300"
        style={{
          fill: isActive || isVisited ? color : "#18181b", // zinc-900
          stroke: isMergeTarget ? "#f59e0b" : color,
          strokeWidth: isMergeTarget ? 2 : isActive || isVisited ? 0 : 1.5,
        }}
      />

      {/* Invisible hit area for hover/click */}
      <circle
        r={NODE_HIT_RADIUS}
        className={`fill-transparent pointer-events-auto ${isMergeTarget ? "cursor-crosshair" : "cursor-pointer"}`}
        onPointerDown={(e) => onPointerDown?.(e, node.id)}
      />
    </g>
  );
});
