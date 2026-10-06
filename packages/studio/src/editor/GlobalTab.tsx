"use client";

import { useState } from "react";
import { useThreadrift } from "@threadrift/react";
import {
  Gauge,
  Magnet,
  Timer,
} from "lucide-react";

export function GlobalTab() {
  const reloadGraph = useThreadrift(s => s.reloadGraph);
  const saveGraph = useThreadrift(s => s.saveGraph);
  const isDirty = useThreadrift(s => s.isDirty);
  const saveError = useThreadrift(s => s.saveError);
  const draftError = useThreadrift(s => s.draftError);
  const autosave = useThreadrift(s => s.autoSaveEnabled);
  const setAutosave = useThreadrift(s => s.setAutoSaveEnabled);
  const toJSON = useThreadrift(s => s.toJSON);
  const hasRecoveryDraft = useThreadrift(s => s.hasRecoveryDraft);
  const restoreDraft = useThreadrift(s => s.restoreDraft);
  const discardDraft = useThreadrift(s => s.discardDraft);
  const saveStatus = useThreadrift((s) => s.saveStatus);
  const lastSaved = useThreadrift((s) => s.lastSaved);

  const [reloadStatus, setReloadStatus] = useState<string | null>(null);
  const [isReloading, setIsReloading] = useState(false);

  async function handleReload() {
    setIsReloading(true);
    const ok = await reloadGraph({ preserveDraft: isDirty });
    setReloadStatus(ok ? "Loaded disk copy" : "Reload failed; current edits retained");
    setIsReloading(false);
  }
  function exportDocument() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(toJSON(), null, 2) + "\n"], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "threadrift.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-3" aria-label="Document persistence">
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-xs text-zinc-200">
            <input type="checkbox" checked={autosave} onChange={event => setAutosave(event.target.checked)} className="accent-sky-400" />
            Autosave
          </label>
          <span role="status" className={saveStatus === "error" ? "text-xs text-red-400" : "text-xs text-zinc-400"}>
            {saveStatus === "saving" ? "Saving..." : saveStatus === "error" ? "Error" : isDirty ? "Unsaved changes" : saveStatus === "saved" ? "Saved" : "Up to date"}
          </span>
        </div>
        <p className="text-[11px] text-zinc-500 leading-relaxed">Graph edits and settings are saved together. {autosave ? "Changes save automatically." : "Use Save now to commit your changes."}</p>
        {saveError && <p role="alert" className="text-xs text-red-400 break-words">{saveError}</p>}
        {draftError && <p role="alert" className="text-xs text-amber-400">{draftError}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={() => void saveGraph()} disabled={saveStatus === "saving"}
            className="flex-1 rounded-lg border border-sky-400/30 px-3 py-2 text-xs text-sky-300 disabled:opacity-50">Save now</button>
          <button type="button" onClick={exportDocument} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-300">Export JSON</button>
        </div>
        <button type="button" onClick={handleReload} disabled={isReloading || saveStatus === "saving"}
          title={isDirty ? "Keeps your edits as a recovery draft before loading the disk copy" : "Load the latest saved graph and settings"}
          className="rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-400 disabled:opacity-50">
          {isReloading ? "Loading..." : isDirty ? "Load disk copy (keep draft)" : "Reload from disk"}
        </button>
        {hasRecoveryDraft && <div className="flex flex-col gap-2 text-xs text-amber-200">
          <p>A local draft differs from the disk copy. Restoring it replaces this document with your draft.</p>
          <button type="button" onClick={restoreDraft} className="rounded border border-amber-300/30 p-2">Restore local draft</button>
          <button type="button" onClick={discardDraft} className="text-zinc-400">Discard local draft</button>
        </div>}
        {lastSaved && <span className="text-[10px] text-zinc-500">Last saved: {new Date(lastSaved).toLocaleTimeString()}</span>}
        {reloadStatus && <span className="text-xs text-zinc-400">{reloadStatus}</span>}
      </section>

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

export function NavigationSettings() {
  const physics = useThreadrift(s => s.physics);
  const updatePhysics = useThreadrift(s => s.updatePhysics);
  return <>
      {/* Physics Tuning */}
      <div className="flex flex-col gap-3">
        <span className="text-zinc-500 text-xs uppercase tracking-wider">
          Navigation
        </span>

        <label className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 text-zinc-400 text-xs">
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

        <label className="flex flex-col gap-1">
          <span className="flex items-center justify-between text-xs text-zinc-400">Touch Sensitivity <span className="text-[10px] font-mono">{physics.touchSensitivity.toFixed(4)}</span></span>
          <input type="range" min={0.0002} max={0.01} step={0.0001} value={physics.touchSensitivity}
            onChange={event => updatePhysics({ touchSensitivity: Number(event.target.value) })}
            className="w-full accent-white h-1 bg-zinc-800 rounded-full appearance-none cursor-pointer
              [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
              [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:cursor-pointer" />
        </label>

        <label className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 text-zinc-400 text-xs">
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

        <label className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 text-zinc-400 text-xs">
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
            max={0.5}
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


  </>;
}
