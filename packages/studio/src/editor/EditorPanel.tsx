"use client";

import { useEffect, useRef } from "react";
import { useThreadrift } from "@threadrift/react";
import { NodeTab } from "./NodeTab";
import { EdgeTab } from "./EdgeTab";
import { GlobalTab, NavigationSettings } from "./GlobalTab";
import { CameraToolbar } from "./CameraControls";
import { Merge, MousePointer2, X } from "lucide-react";

export function EditorPanel() {
  const editorOpen = useThreadrift(s => s.editorOpen);
  const toggleEditor = useThreadrift(s => s.toggleEditor);
  const selectedNode = useThreadrift(s => s.selectedNode);
  const selectedEdge = useThreadrift(s => s.selectedEdge);
  const graph = useThreadrift(s => s.graph);
  const selectNode = useThreadrift(s => s.selectNode);
  const selectEdge = useThreadrift(s => s.selectEdge);
  const mergeModeSource = useThreadrift(s => s.mergeModeSource);
  const setMergeMode = useThreadrift(s => s.setMergeMode);
  const saveStatus = useThreadrift(s => s.saveStatus);
  const isDirty = useThreadrift(s => s.isDirty);
  const saveError = useThreadrift(s => s.saveError);
  const draftError = useThreadrift(s => s.draftError);
  const hasRecoveryDraft = useThreadrift(s => s.hasRecoveryDraft);
  const node = selectedNode === null ? undefined : graph.nodes[selectedNode];
  const edge = graph.edges.find(edge => edge.id === selectedEdge);
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (contentRef.current) contentRef.current.scrollTop = 0; }, [selectedNode, selectedEdge]);
  if (!editorOpen) return null;

  return <aside aria-label="Threadrift Studio" data-threadrift-controls=""
    className="fixed top-0 right-0 z-[150] h-[100dvh] w-80 max-w-full border-l border-white/10 bg-zinc-950 text-zinc-200 shadow-2xl flex flex-col overflow-hidden pointer-events-auto">
    <header className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3">
      <div>
        <h2 className="text-sm font-medium">Threadrift Studio</h2>
        <p role="status" className="mt-1 text-xs text-zinc-400">{saveStatus === "saving" ? "Saving…" : saveStatus === "error" ? "Save failed" : isDirty ? "Unsaved changes" : "Up to date"}</p>
      </div>
      <button type="button" aria-label="Close editor" onClick={toggleEditor} className="flex h-11 w-11 items-center justify-center rounded-md hover:bg-zinc-800 focus-visible:outline-sky-400"><X size={18} /></button>
    </header>
    <div ref={contentRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <label className="mb-4 flex flex-col gap-2 text-xs text-zinc-400">Inspect
        <select aria-label="Inspect" value={node ? `node:${node.id}` : edge ? `edge:${edge.id}` : ""}
          onChange={event => {
            const value = event.target.value;
            if (value.startsWith("edge:")) selectEdge(value.slice(5));
            else selectNode(value ? Number(value.slice(5)) : null);
          }} className="min-h-11 w-full min-w-0 rounded-md border border-white/10 bg-zinc-900 px-2 text-zinc-100 focus:outline-sky-400">
          <option value="">Nothing selected</option>
          <optgroup label="Nodes">{Object.values(graph.nodes).map(node => <option key={node.id} value={`node:${node.id}`}>{node.name || "Node"} · {node.id}</option>)}</optgroup>
          <optgroup label="Edges">{graph.edges.map(edge => <option key={edge.id} value={`edge:${edge.id}`}>{graph.nodes[edge.from]?.name || edge.from} → {graph.nodes[edge.to]?.name || edge.to} · {edge.id}</option>)}</optgroup>
        </select>
      </label>
      <CameraToolbar />
      {(saveError || draftError) && <p role="alert" className="mb-3 break-words text-xs text-red-300">{saveError || draftError}</p>}
      {hasRecoveryDraft && <p role="status" className="mb-3 text-xs text-amber-200">A local recovery draft is available in Settings below.</p>}
      {mergeModeSource !== null && <div role="status" className="mb-4 flex flex-col gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-200">
        <span className="flex items-center gap-2"><Merge size={16} />Choose a target for {graph.nodes[mergeModeSource]?.name || "this node"}.</span>
        <button type="button" onClick={() => setMergeMode(null)} className="min-h-11 rounded-md border border-amber-500/30">Cancel Merge</button>
      </div>}
      <section aria-label="Selection inspector">
        {(node || edge) ? <>
          <div className="mb-4 flex items-center justify-between gap-2">
            <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-400">{node ? `Node · Level ${node.level ?? 1}` : "Edge"}</h3>
            <button type="button" aria-label="Clear selection" onClick={() => selectNode(null)} className="min-h-11 rounded-md px-2 text-xs text-zinc-400 hover:bg-zinc-800 focus-visible:outline-sky-400">Deselect</button>
          </div>
          {node ? <NodeTab key={node.id} /> : <EdgeTab key={edge!.id} />}
        </> : <div className="flex items-start gap-3 py-6 text-sm text-zinc-400">
          <MousePointer2 size={18} className="mt-0.5 shrink-0" />
          <p>Select a node or edge to edit it.</p>
        </div>}
      </section>
      <details className="mt-6 border-t border-white/10 pt-3">
        <summary role="button" className="min-h-11 cursor-pointer py-3 text-sm font-medium focus-visible:outline-sky-400">Settings</summary>
        <GlobalTab />
      </details>
    </div>
    <section aria-label="Navigation settings" className="max-h-[40dvh] shrink-0 overflow-y-auto border-t border-white/10 bg-zinc-900 px-4 py-3">
      <NavigationSettings />
    </section>
  </aside>;
}
