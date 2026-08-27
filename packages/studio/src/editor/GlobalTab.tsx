"use client";

import { useState } from "react";
import { useThreadrift } from "@threadrift/react";
import {
  Gauge,
  Magnet,
  Timer,
  RotateCcw,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Cloud,
} from "lucide-react";

export function GlobalTab() {
  const loadGraph = useThreadrift((s) => s.loadGraph);
  const physics = useThreadrift((s) => s.physics);
  const updatePhysics = useThreadrift((s) => s.updatePhysics);
  const saveStatus = useThreadrift((s) => s.saveStatus);
  const lastSaved = useThreadrift((s) => s.lastSaved);

  const [reloadStatus, setReloadStatus] = useState<string | null>(null);
  const [isReloading, setIsReloading] = useState(false);

  async function handleReload() {
    setIsReloading(true);
    try {
      const res = await fetch("/api/graph", { cache: "no-store" }).catch(() =>
        fetch("/data/graph.json", { cache: "no-store" })
      );
      if (!res.ok) throw new Error("Failed to reload");
      const data = await res.json();
      loadGraph(data);
      setReloadStatus("Reloaded from disk!");
      setTimeout(() => setReloadStatus(null), 2500);
    } catch (err) {
      console.error("Reload failed:", err);
      setReloadStatus("Reload failed");
      setTimeout(() => setReloadStatus(null), 3000);
    } finally {
      setIsReloading(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Real-time Auto-Save Status */}
      <div className="flex flex-col gap-2">
        <span className="text-zinc-500 text-xs uppercase tracking-wider">
          Persistence
        </span>

        <div className="bg-zinc-900/50 border border-white/5 rounded-xl p-3.5 flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cloud className="w-4 h-4 text-sky-400" />
              <span className="text-xs font-medium text-zinc-200">
                Real-Time Auto-Save
              </span>
            </div>

            {/* Status Pill */}
            {saveStatus === "saving" && (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono bg-sky-500/10 text-sky-400 border border-sky-500/20">
                <Loader2 className="w-2.5 h-2.5 animate-spin" />
                Saving...
              </span>
            )}
            {saveStatus === "saved" && (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <CheckCircle2 className="w-2.5 h-2.5" />
                Saved
              </span>
            )}
            {saveStatus === "idle" && (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/10 text-emerald-400/80 border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Active
              </span>
            )}
            {saveStatus === "error" && (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono bg-red-500/10 text-red-400 border border-red-500/20">
                <AlertCircle className="w-2.5 h-2.5" />
                Error
              </span>
            )}
          </div>

          <p className="text-[11px] text-zinc-500 leading-relaxed">
            All changes to nodes, branches, and positions are automatically
            saved permanently to <code className="text-zinc-400 font-mono">public/data/graph.json</code> in real-time.
          </p>

          {lastSaved && (
            <div className="text-[10px] text-zinc-600 font-mono">
              Last saved: {new Date(lastSaved).toLocaleTimeString()}
            </div>
          )}
        </div>

        <button
          onClick={handleReload}
          disabled={isReloading}
          className="flex items-center justify-center gap-2 w-full px-3 py-2 rounded-lg 
            bg-zinc-900/40 hover:bg-zinc-800/60 border border-white/5 hover:border-white/10 
            transition-all text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer disabled:opacity-50 mt-1"
        >
          <RotateCcw
            className={`w-3.5 h-3.5 text-zinc-500 ${
              isReloading ? "animate-spin" : ""
            }`}
          />
          Reload from Disk
        </button>

        {reloadStatus && (
          <div className="text-xs text-emerald-400/80 text-center mt-1">
            {reloadStatus}
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="h-px bg-white/5" />

      {/* Physics Tuning */}
      <div className="flex flex-col gap-4">
        <span className="text-zinc-500 text-xs uppercase tracking-wider">
          Live Physics Tuning
        </span>

        <label className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-zinc-400 text-xs">
              <Gauge className="w-3.5 h-3.5 text-zinc-500" />
              Scroll Sensitivity
            </div>
            <span className="text-[10px] text-zinc-500 font-mono">
              {physics.scrollSensitivity.toFixed(4)}
            </span>
          </div>
          <input
            type="range"
            min={0.0002}
            max={0.005}
            step={0.0001}
            value={physics.scrollSensitivity}
            onChange={(e) =>
              updatePhysics({ scrollSensitivity: Number(e.target.value) })
            }
            className="w-full accent-white h-1 bg-zinc-800 rounded-full appearance-none cursor-pointer
              [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 
              [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white 
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:cursor-pointer"
          />
        </label>

        <label className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-zinc-400 text-xs">
              <Magnet className="w-3.5 h-3.5 text-zinc-500" />
              Snap Strength
            </div>
            <span className="text-[10px] text-zinc-500 font-mono">
              {physics.snapStrength.toFixed(3)}
            </span>
          </div>
          <input
            type="range"
            min={0.05}
            max={0.4}
            step={0.01}
            value={physics.snapStrength}
            onChange={(e) =>
              updatePhysics({ snapStrength: Number(e.target.value) })
            }
            className="w-full accent-white h-1 bg-zinc-800 rounded-full appearance-none cursor-pointer
              [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 
              [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white 
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:cursor-pointer"
          />
        </label>

        <label className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-zinc-400 text-xs">
              <Timer className="w-3.5 h-3.5 text-zinc-500" />
              Snap Threshold
            </div>
            <span className="text-[10px] text-zinc-500 font-mono">
              {physics.snapThreshold.toFixed(2)}
            </span>
          </div>
          <input
            type="range"
            min={0.1}
            max={0.8}
            step={0.02}
            value={physics.snapThreshold}
            onChange={(e) =>
              updatePhysics({ snapThreshold: Number(e.target.value) })
            }
            className="w-full accent-white h-1 bg-zinc-800 rounded-full appearance-none cursor-pointer
              [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 
              [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white 
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:cursor-pointer"
          />
        </label>
      </div>

      {/* Graph Stats */}
      <div className="h-px bg-white/5" />
      <GraphStats />
    </div>
  );
}

function GraphStats() {
  const graph = useThreadrift((s) => s.graph);
  const nodeCount = Object.keys(graph.nodes).length;
  const edgeCount = graph.edges.length;
  const mainEdges = graph.edges.filter((e) => e.type === "main").length;
  const branchEdges = graph.edges.filter((e) => e.type === "branch").length;

  return (
    <div className="flex flex-col gap-2">
      <span className="text-zinc-500 text-xs uppercase tracking-wider">
        Threadrift Stats
      </span>
      <div className="grid grid-cols-2 gap-2">
        <StatCard label="Nodes" value={nodeCount} />
        <StatCard label="Edges" value={edgeCount} />
        <StatCard label="Main" value={mainEdges} />
        <StatCard label="Branch" value={branchEdges} />
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-zinc-900/40 border border-white/5 rounded-lg px-3 py-2 text-center">
      <div className="text-lg font-light text-white font-mono">{value}</div>
      <div className="text-[10px] text-zinc-600 uppercase tracking-wider">
        {label}
      </div>
    </div>
  );
}
