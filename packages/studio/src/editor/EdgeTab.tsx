"use client";

import { useState } from "react";
import { useThreadrift } from "@threadrift/react";
import { Spline, GitBranch, Trash2 } from "lucide-react";
import { getLevelColor } from "@threadrift/core";
import { CommitNumber } from "./CameraControls";

export function EdgeTab() {
  const [curveTarget, setCurveTarget] = useState<"start" | "end">("start");
  const selectedEdge = useThreadrift((s) => s.selectedEdge);
  const graph = useThreadrift((s) => s.graph);
  const updateEdge = useThreadrift((s) => s.updateEdge);
  const removeEdge = useThreadrift((s) => s.removeEdge);

  if (!selectedEdge) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-zinc-600 text-sm">
        <Spline className="w-8 h-8 mb-3 opacity-40" />
        <span>Click an edge on the canvas</span>
        <span className="text-xs text-zinc-700 mt-1">to adjust its curve & divergence</span>
      </div>
    );
  }

  const edge = graph.edges.find((e) => e.id === selectedEdge);
  if (!edge) return null;

  const fromNode = graph.nodes[edge.from];
  const toNode = graph.nodes[edge.to];
  const fromColor = fromNode ? getLevelColor(fromNode.level) : "#555";
  const toColor = toNode ? getLevelColor(toNode.level) : "#555";

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <div
            className="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: fromColor }}
          />
          <span className="text-zinc-500 text-xs">→</span>
          <div
            className="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: toColor }}
          />
        </div>
        <span className="text-xs text-zinc-500 font-mono tracking-wide">
          {fromNode?.name || edge.from} → {toNode?.name || edge.to}
        </span>
        <span
          className={`text-[10px] uppercase tracking-widest rounded px-1.5 py-0.5 border ${
            edge.type === "main"
              ? "text-emerald-500/70 border-emerald-500/20"
              : "text-sky-500/70 border-sky-500/20"
          }`}
        >
          {edge.type}
        </span>
      </div>

      {/* Curve Control */}
      <label className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-zinc-500 text-xs uppercase tracking-wider">
            <Spline className="w-3.5 h-3.5" />
            Curve
          </div>
          <span className="text-[10px] text-zinc-600 font-mono">
            {(curveTarget === "start" ? (edge.curve ?? 0) : (edge.curveEnd ?? 0)).toFixed(2)}
          </span>
        </div>

        {/* Start/End Toggle */}
        <div className="flex p-0.5 bg-zinc-900 rounded-md border border-white/5 mb-1">
          <button
            type="button"
            onClick={() => setCurveTarget("start")}
            className={`flex-1 text-[10px] uppercase font-bold py-1 rounded transition-colors ${
              curveTarget === "start" ? "bg-zinc-800 text-white" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            Start
          </button>
          <button
            type="button"
            onClick={() => setCurveTarget("end")}
            className={`flex-1 text-[10px] uppercase font-bold py-1 rounded transition-colors ${
              curveTarget === "end" ? "bg-zinc-800 text-white" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            End
          </button>
        </div>

        <input
          type="range"
          min={-1}
          max={1}
          step={0.01}
          value={curveTarget === "start" ? (edge.curve ?? 0) : (edge.curveEnd ?? 0)}
          onChange={(e) => {
            if (curveTarget === "start") {
              updateEdge(edge.id, { curve: Number(e.target.value) });
            } else {
              updateEdge(edge.id, { curveEnd: Number(e.target.value) });
            }
          }}
          className="w-full accent-white h-1 bg-zinc-800 rounded-full appearance-none cursor-pointer
            [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 
            [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white 
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:cursor-pointer"
        />
        <p className="text-[10px] text-zinc-700 leading-relaxed">
          Controls the bézier sweep of the path. Positive values curve one
          direction, negative the other.
        </p>
      </label>

      {/* Divergence Control */}
      {edge.type === "branch" && (
        <label className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-zinc-500 text-xs uppercase tracking-wider">
              <GitBranch className="w-3.5 h-3.5" />
              Divergence
            </div>
            <span className="text-[10px] text-zinc-600 font-mono">
              {(edge.diverge ?? 0).toFixed(2)}
            </span>
          </div>
          <input
            type="range"
            min={-0.5}
            max={0.5}
            step={0.01}
            value={edge.diverge ?? 0}
            onChange={(e) =>
              updateEdge(edge.id, { diverge: Number(e.target.value) })
            }
            className="w-full accent-white h-1 bg-zinc-800 rounded-full appearance-none cursor-pointer
              [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 
              [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white 
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:cursor-pointer"
          />
          <p className="text-[10px] text-zinc-700 leading-relaxed">
            Rotates the departure direction from the parent’s tangent.
            Negative and positive values turn in opposite directions.
          </p>
        </label>
      )}

      <section aria-label="Camera transition" className="flex flex-col gap-3">
        <label className="flex flex-col gap-2 text-xs text-zinc-400">Camera travel
          <select aria-label="Camera travel" value={edge.camera?.mode ?? "path"}
            onChange={event => updateEdge(edge.id, { camera: { mode: event.target.value as "path" | "direct", start: edge.camera?.start ?? 0, end: edge.camera?.end ?? 1 } })}
            className="rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-zinc-100">
            <option value="path">Follow path shape</option><option value="direct">Direct between views</option>
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <CommitNumber label="Move starts (%)" value={(edge.camera?.start ?? 0) * 100} min={0} max={99.9} step={1}
            onCommit={value => updateEdge(edge.id, { camera: { mode: edge.camera?.mode ?? "path", start: value / 100, end: edge.camera?.end ?? 1 } })} />
          <CommitNumber label="Move ends (%)" value={(edge.camera?.end ?? 1) * 100} min={.1} max={100} step={1}
            onCommit={value => updateEdge(edge.id, { camera: { mode: edge.camera?.mode ?? "path", start: edge.camera?.start ?? 0, end: value / 100 } })} />
        </div>
        <p className="text-xs leading-relaxed text-zinc-500">Percentages refer to travel along this connection. The view holds before and after the movement window. Matching saved views hold throughout.</p>
        {edge.camera && <button type="button" onClick={() => updateEdge(edge.id, { camera: undefined })} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-300">Reset camera travel</button>}
      </section>
      {/* Divider */}
      <div className="h-px bg-white/5" />

      {/* Delete */}
      <button
        onClick={() => {
          removeEdge(edge.id);
        }}
        className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg 
          bg-red-500/5 hover:bg-red-500/10 border border-red-500/10 hover:border-red-500/20 
          transition-all text-sm text-red-400/70 hover:text-red-400 cursor-pointer"
      >
        <Trash2 className="w-4 h-4" />
        Delete Edge
      </button>
    </div>
  );
}
