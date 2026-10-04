"use client";

import { memo } from "react";
import { DEFAULT_ANCHOR } from "@threadrift/core";
import { useThreadrift } from "../context/ThreadriftContext";

export interface ThreadriftNodeProps {
  id: number | string;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export const Node = memo(function ThreadriftNode({
  id,
  children,
  className = "",
  style = {},
}: ThreadriftNodeProps) {
  // Convert id to number since the core graph uses numeric IDs internally
  const numericId = typeof id === "string" ? parseInt(id, 10) : id;
  
  // Select only the specific node from the store to prevent unnecessary re-renders
  const node = useThreadrift((s) => s.graph.nodes[numericId]);

  if (!node) {
    console.warn(`[Threadrift] Node with id ${id} not found in graph.`);
    return null;
  }

  const anchorX = node.anchorX ?? DEFAULT_ANCHOR.x;
  const anchorY = node.anchorY ?? DEFAULT_ANCHOR.y;
  const anchorWidth = node.anchorWidth ?? DEFAULT_ANCHOR.width;

  return (
    <div
      data-threadrift-anchor={numericId}
      className={className}
      style={{
        position: "absolute",
        pointerEvents: "auto",
        left: `calc(${node.x}px * var(--threadrift-world-scale, 1) + ${anchorX}px)`,
        top: `calc(${node.y}px * var(--threadrift-world-scale, 1) + ${anchorY}px)`,
        width: anchorWidth,
        ...style,
      }}
    >
      {children}
    </div>
  );
});
