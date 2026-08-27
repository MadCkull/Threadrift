"use client";

import { memo } from "react";
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

  const anchorX = node.anchorX ?? 0;
  const anchorY = node.anchorY ?? 0;
  const anchorScale = node.anchorScale ?? 1;

  return (
    <div
      className={`absolute pointer-events-auto ${className}`}
      style={{
        left: node.x,
        top: node.y,
        // Center the wrapper exactly on the node coordinate, plus anchor offsets
        transform: `translate(calc(-50% + ${anchorX}px), calc(-50% + ${anchorY}px)) scale(${anchorScale})`,
        ...style,
      }}
    >
      {children}
    </div>
  );
});
