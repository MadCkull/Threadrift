"use client";

import { useThreadrift } from "@threadrift/react";
import {
  Type,
  FileText,
  Move,
  GitBranchPlus,
  GitFork,
  Trash2,
  Merge,
} from "lucide-react";
import { getLevelColor, getNodeEditCapabilities } from "@threadrift/core";
import { AnchorTab } from "./AnchorTab";
import { NodeCameraControls, NodePositionControls } from "./CameraControls";

export function NodeTab() {
  const selectedNode = useThreadrift((s) => s.selectedNode);
  const graph = useThreadrift((s) => s.graph);
  const updateNode = useThreadrift((s) => s.updateNode);
  const addNode = useThreadrift((s) => s.addNode);
  const removeNode = useThreadrift((s) => s.removeNode);
  const mergeModeSource = useThreadrift((s) => s.mergeModeSource);
  const setMergeMode = useThreadrift((s) => s.setMergeMode);

  if (selectedNode === null) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-zinc-600 text-sm">
        <Move className="w-8 h-8 mb-3 opacity-40" />
        <span>Click a node on the canvas</span>
        <span className="text-xs text-zinc-700 mt-1">to inspect & edit</span>
      </div>
    );
  }

  const node = graph.nodes[selectedNode];
  if (!node) return null;

  const color = getLevelColor(node.level);
  const isRoot = node.id === graph.root;
  const exits = graph.edges.filter(edge => edge.from === node.id);
  const capabilities = getNodeEditCapabilities(graph, node.id);

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div
          className="w-3 h-3 rounded-full shrink-0"
          style={{ backgroundColor: color }}
        />
        <span className="text-xs text-zinc-500 font-mono tracking-wide">
          ID: {node.id}
        </span>
        {isRoot && (
          <span className="text-[10px] uppercase tracking-widest text-amber-500/70 border border-amber-500/20 rounded px-1.5 py-0.5">
            Root
          </span>
        )}
      </div>

      {/* Name Input */}
      <label className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 text-zinc-500 text-xs uppercase tracking-wider">
          <Type className="w-3.5 h-3.5" />
          Name
        </div>
        <input
          type="text"
          value={node.name}
          onChange={(e) => updateNode(node.id, { name: e.target.value })}
          className="w-full bg-zinc-900/60 border border-white/5 rounded-lg px-3 py-2 text-sm text-white 
            placeholder-zinc-600 focus:outline-none focus:border-white/15 
            transition-colors font-sans"
          placeholder="Node name..."
        />
      </label>

      {/* Content Input */}
      <label className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 text-zinc-500 text-xs uppercase tracking-wider">
          <FileText className="w-3.5 h-3.5" />
          Content
        </div>
        <textarea
          value={node.content}
          onChange={(e) => updateNode(node.id, { content: e.target.value })}
          rows={3}
          className="w-full bg-zinc-900/60 border border-white/5 rounded-lg px-3 py-2 text-sm text-white 
            placeholder-zinc-600 focus:outline-none focus:border-white/15 
            transition-colors resize-none font-sans"
          placeholder="Node content..."
        />
      </label>

      {exits.length > 1 && <label className="flex flex-col gap-1.5">
        <span className="text-zinc-500 text-xs uppercase tracking-wider">Recommended path</span>
        <select
          value={node.recommendedEdgeId ?? ""}
          onChange={event => updateNode(node.id, { recommendedEdgeId: event.target.value || undefined })}
          className="w-full bg-zinc-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-sky-400"
        >
          <option value="">Automatic · straightest continuation</option>
          {exits.map((edge, index) => <option key={edge.id} value={edge.id}>
            {graph.nodes[edge.to]?.name ?? "Unknown destination"}
            {exits.some(other => other.id !== edge.id && other.to === edge.to) ? ` · Route ${index + 1}` : ""}
          </option>)}
        </select>
        <span className="text-xs text-zinc-500 leading-relaxed">Preselected for visitors. Their own route choice always takes priority.</span>
      </label>}

      <NodePositionControls id={node.id} />
      <NodeCameraControls id={node.id} />
      <details className="border-t border-white/10 pt-2">
        <summary role="button" className="min-h-11 cursor-pointer py-3 text-sm text-zinc-300 focus-visible:outline-sky-400">Anchors</summary>
        <AnchorTab />
      </details>

      {/* Divider */}
      <div className="h-px bg-white/5" />

      {/* Actions */}
      <div className="flex flex-col gap-2">
        <span className="text-zinc-500 text-xs uppercase tracking-wider mb-1">
          Actions
        </span>
        {capabilities.canAddMain && <button
          onClick={() => addNode(node.id, "main")}
          className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg 
            bg-zinc-900/40 hover:bg-zinc-800/60 border border-white/5 hover:border-white/10 
            transition-all text-sm text-zinc-300 hover:text-white cursor-pointer"
        >
          <GitBranchPlus className="w-4 h-4 text-zinc-500" />
          Add Main Child
        </button>}
        {capabilities.canAddBranch && <button
          onClick={() => addNode(node.id, "branch")}
          className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg 
            bg-zinc-900/40 hover:bg-zinc-800/60 border border-white/5 hover:border-white/10 
            transition-all text-sm text-zinc-300 hover:text-white cursor-pointer"
        >
          <GitFork className="w-4 h-4 text-zinc-500" />
          Add Branch Child
        </button>}

        {mergeModeSource === null && capabilities.mergeTargets.length > 0 && <button
          onClick={() => setMergeMode(node.id)}
          className="flex min-h-11 items-center gap-2.5 rounded-lg border border-white/10 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800">
          <Merge className="w-4 h-4 text-zinc-500" />Merge to Node...
        </button>}

        {!isRoot && (
          <button
            title="Also removes descendants that lose all incoming connections"
            onClick={() => {
              removeNode(node.id);
            }}
            className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg 
              bg-red-500/5 hover:bg-red-500/10 border border-red-500/10 hover:border-red-500/20 
              transition-all text-sm text-red-400/70 hover:text-red-400 cursor-pointer mt-1"
          >
            <Trash2 className="w-4 h-4" />
            Delete Node
          </button>
        )}
      </div>
    </div>
  );
}
