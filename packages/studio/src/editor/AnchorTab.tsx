"use client";

import { useThreadrift } from "@threadrift/react";
import { DEFAULT_ANCHOR } from "@threadrift/core";
import { Anchor, MoveHorizontal, ArrowDownToLine, ArrowRightToLine } from "lucide-react";

export function AnchorTab() {
  const selectedNode = useThreadrift((s) => s.selectedNode);
  const graph = useThreadrift((s) => s.graph);
  const updateNode = useThreadrift((s) => s.updateNode);

  if (selectedNode === null) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-zinc-600 text-sm">
        <Anchor className="w-8 h-8 mb-3 opacity-40" />
        <span>Select a node on the canvas</span>
        <span className="text-xs text-zinc-700 mt-1">to adjust its HTML anchors</span>
      </div>
    );
  }

  const node = graph.nodes[selectedNode];
  if (!node) return null;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-zinc-900 border border-white/5">
          <Anchor className="w-4 h-4 text-emerald-400" />
        </div>
        <div>
          <h3 className="text-sm font-medium text-white">{node.name}</h3>
          <p className="text-xs text-zinc-500 font-mono tracking-wide">
            ID: {node.id}
          </p>
        </div>
      </div>

      <div className="h-px bg-white/5" />

      {/* Anchor Settings */}
      <div className="flex flex-col gap-5">
        <h4 className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold mb-1">
          Spatial Offsets
        </h4>

        {/* X Offset */}
        <label className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-zinc-400 text-xs">
              <ArrowRightToLine className="w-3.5 h-3.5" />
              Offset X
            </div>
            <span className="text-[10px] text-zinc-500 font-mono w-8 text-right">
              {node.anchorX ?? DEFAULT_ANCHOR.x}px
            </span>
          </div>
          <input
            type="range"
            min={-500}
            max={500}
            step={1}
            value={node.anchorX ?? DEFAULT_ANCHOR.x}
            onChange={(e) => updateNode(node.id, { anchorX: Number(e.target.value) })}
            className="w-full accent-emerald-500 h-1 bg-zinc-800 rounded-full appearance-none cursor-pointer
              [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 
              [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-emerald-500 
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:cursor-pointer"
          />
        </label>

        {/* Y Offset */}
        <label className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-zinc-400 text-xs">
              <ArrowDownToLine className="w-3.5 h-3.5" />
              Offset Y
            </div>
            <span className="text-[10px] text-zinc-500 font-mono w-8 text-right">
              {node.anchorY ?? DEFAULT_ANCHOR.y}px
            </span>
          </div>
          <input
            type="range"
            min={-500}
            max={500}
            step={1}
            value={node.anchorY ?? DEFAULT_ANCHOR.y}
            onChange={(e) => updateNode(node.id, { anchorY: Number(e.target.value) })}
            className="w-full accent-emerald-500 h-1 bg-zinc-800 rounded-full appearance-none cursor-pointer
              [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 
              [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-emerald-500 
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:cursor-pointer"
          />
        </label>
        
        {/* Content layout width; child styling and height belong to the application. */}
        <label className="flex flex-col gap-2 mt-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-zinc-400 text-xs">
              <MoveHorizontal className="w-3.5 h-3.5" />
              Anchor Width
            </div>
            <span className="text-[10px] text-zinc-500 font-mono w-8 text-right">
              {node.anchorWidth ?? DEFAULT_ANCHOR.width}px
            </span>
          </div>
          <input
            type="number"
            min={1}
            step={1}
            value={node.anchorWidth ?? DEFAULT_ANCHOR.width}
            onChange={(e) => { const width = e.target.valueAsNumber; if (Number.isFinite(width) && width > 0) updateNode(node.id, { anchorWidth: width }); }}
            className="w-full rounded-md border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
          />
        </label>
      </div>

      {/* Helper text */}
      <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
        <p className="text-[10px] text-emerald-400/80 leading-relaxed text-center">
          X and Y position the content’s top-left corner relative to this node. Width sets the available layout space in pixels. Height, appearance and child sizing belong to your React component.
        </p>
      </div>
    </div>
  );
}
