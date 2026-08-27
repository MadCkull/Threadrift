import { memo } from "react";
import type { GraphNode } from "@threadrift/core";
import { LABEL_OFFSET, LABEL_SNAP_RADIUS, getLevelColor } from "@threadrift/core";
import { useThreadrift } from "../context/ThreadriftContext";

interface GraphLabelsProps {
  nodes: GraphNode[];
}

export const GraphLabels = memo(function GraphLabels({
  nodes,
}: GraphLabelsProps) {
  const scrollCurrent = useThreadrift((s) => s.scrollCurrent);
  
  // Find which node is currently active based on scroll
  const activeIdx = Math.round(scrollCurrent);
  const activeNode = nodes[activeIdx];

  if (!activeNode) return null;

  // Calculate distance from exact integer index
  const dist = Math.abs(scrollCurrent - activeIdx);
  
  // Calculate dynamic opacity: fades out quickly as we move away from the node center
  const opacity = Math.max(0, 1 - dist / LABEL_SNAP_RADIUS);

  if (opacity <= 0.01) return null;

  const color = getLevelColor(activeNode.level);

  return (
    <g
      className="node-label-group transition-opacity duration-150 pointer-events-none select-none"
      transform={`translate(${activeNode.x + LABEL_OFFSET.x}, ${
        activeNode.y + LABEL_OFFSET.y
      })`}
      style={{ opacity }}
    >
      {/* Node Name */}
      <text
        x={0}
        y={0}
        className="text-[12px] font-mono tracking-wider fill-white font-medium drop-shadow-md"
        dominantBaseline="middle"
      >
        {activeNode.name}
      </text>

      {/* Node Content / Subtitle if available */}
      {activeNode.content && (
        <text
          x={0}
          y={16}
          className="text-[10px] font-sans tracking-normal fill-zinc-400 font-light drop-shadow-sm"
          dominantBaseline="middle"
        >
          {activeNode.content.length > 45
            ? activeNode.content.substring(0, 45) + "..."
            : activeNode.content}
        </text>
      )}

      {/* Level Tag Indicator */}
      <circle
        cx={-12}
        cy={0}
        r={2.5}
        style={{ fill: color }}
      />
    </g>
  );
});
