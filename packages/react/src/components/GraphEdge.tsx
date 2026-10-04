import { memo, useId } from "react";
import type { GraphEdge, Sequence, GraphNode } from "@threadrift/core";
import { edgePath } from "@threadrift/core";
import { EDGE_HIT_WIDTH, getLevelColor } from "@threadrift/core";

interface GraphEdgeProps {
  edge: GraphEdge;
  sequences: Sequence[];
  getNode: (id: number) => GraphNode | undefined;
  isActive: boolean;
  isSelected?: boolean;
  onPointerDown?: (e: React.PointerEvent, edgeId: string) => void;
}

export const GraphEdgeComponent = memo(function GraphEdgeComponent({
  edge,
  sequences,
  getNode,
  isActive,
  isSelected,
  onPointerDown,
}: GraphEdgeProps) {
  const gradientId = useId();
  const d = edgePath(edge, sequences, getNode);
  if (!d) return null;

  const fromNode = getNode(edge.from);
  const toNode = getNode(edge.to);
  const fromColor = fromNode ? getLevelColor(fromNode.level) : "#3f3f46"; // zinc-700
  const toColor = toNode ? getLevelColor(toNode.level) : "#3f3f46";

  return (
    <g className="node-edge-group">
      <defs>
        <linearGradient
          id={gradientId}
          x1={fromNode?.x ?? 0}
          y1={fromNode?.y ?? 0}
          x2={toNode?.x ?? 0}
          y2={toNode?.y ?? 0}
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor={fromColor} />
          <stop offset="100%" stopColor={toColor} />
        </linearGradient>
      </defs>

      {/* Background track (inactive) */}
      <path
        d={d}
        className="fill-none stroke-zinc-900 transition-colors duration-500"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Active Fill (Masked by JS progress later, but colored here) */}
      <path
        data-threadrift-edge-fill={edge.id}
        d={d}
        className={`fill-none transition-colors duration-500 ${
          isActive ? "" : "stroke-transparent"
        }`}
        style={{
          stroke: isActive ? `url(#${gradientId})` : undefined,
        }}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Selection Overlay */}
      {isSelected && (
        <path
          d={d}
          className="fill-none stroke-amber-400"
          strokeWidth={1.5}
          strokeDasharray="6 4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}

      {/* Invisible hit area for clicks */}
      <path
        d={d}
        data-threadrift-edge={edge.id}
        className="fill-none stroke-transparent pointer-events-auto cursor-pointer"
        strokeWidth={EDGE_HIT_WIDTH}
        onPointerDown={(e) => onPointerDown?.(e, edge.id)}
      />
    </g>
  );
});
