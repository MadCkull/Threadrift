"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useThreadrift } from "@threadrift/react";
import { NodeTab } from "./NodeTab";
import { EdgeTab } from "./EdgeTab";
import { GlobalTab } from "./GlobalTab";
import { AnchorTab } from "./AnchorTab";
import {
  CircleDot,
  Spline,
  SlidersHorizontal,
  X,
  Merge,
  Anchor,
} from "lucide-react";

type TabId = "node" | "edge" | "anchors" | "global";

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "node", label: "Node", icon: <CircleDot className="w-3.5 h-3.5" /> },
  { id: "edge", label: "Edge", icon: <Spline className="w-3.5 h-3.5" /> },
  { id: "anchors", label: "Anchors", icon: <Anchor className="w-3.5 h-3.5" /> },
  {
    id: "global",
    label: "Settings",
    icon: <SlidersHorizontal className="w-3.5 h-3.5" />,
  },
];

export function EditorPanel() {
  const editorOpen = useThreadrift((s) => s.editorOpen);
  const toggleEditor = useThreadrift((s) => s.toggleEditor);
  const selectedNode = useThreadrift((s) => s.selectedNode);
  const selectedEdge = useThreadrift((s) => s.selectedEdge);
  const mergeModeSource = useThreadrift((s) => s.mergeModeSource);

  // Auto-switch tab based on selection
  const autoTab: TabId = selectedEdge ? "edge" : selectedNode !== null ? "node" : "node";
  const [manualTab, setManualTab] = useState<TabId | null>(null);
  const activeTab = manualTab ?? autoTab;

  const handleTabClick = (id: TabId) => {
    setManualTab(id);
  };

  return (
    <AnimatePresence>
      {editorOpen && (
        <motion.div
          initial={{ x: "100%", opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: "100%", opacity: 0 }}
          transition={{
            type: "spring",
            damping: 30,
            stiffness: 300,
            mass: 0.8,
          }}
          className="fixed top-0 right-0 z-[150] h-full w-80 
            bg-black/70 backdrop-blur-2xl border-l border-white/5 
            flex flex-col overflow-hidden shadow-2xl shadow-black/80 pointer-events-auto"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
              <h2 className="text-sm font-medium text-white tracking-wide">
                Threadrift Studio
              </h2>
            </div>
            <button
              onClick={toggleEditor}
              className="w-7 h-7 flex items-center justify-center rounded-md 
                hover:bg-zinc-800/60 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4 text-zinc-500" />
            </button>
          </div>

          {/* Merge Mode Banner */}
          {mergeModeSource !== null && (
            <div className="mx-4 mt-3 px-3 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 
              flex items-center gap-2.5 text-amber-400 text-xs">
              <Merge className="w-4 h-4 shrink-0" />
              <span>
                <strong>Merge Mode</strong> — Click a target node on the canvas
                to create a merge edge.
              </span>
            </div>
          )}

          {/* Tab Bar */}
          <div className="flex px-4 pt-4 gap-1">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleTabClick(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-all cursor-pointer ${
                  activeTab === tab.id
                    ? "bg-zinc-800/80 text-white border border-white/10"
                    : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/40 border border-transparent"
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto px-5 py-4 custom-scrollbar">
            {activeTab === "node" && <NodeTab />}
            {activeTab === "edge" && <EdgeTab />}
            {activeTab === "anchors" && <AnchorTab />}
            {activeTab === "global" && <GlobalTab />}
          </div>

          {/* Footer */}
          <div className="px-5 py-3 border-t border-white/5 text-[10px] text-zinc-700 text-center tracking-wider uppercase">
            Threadrift Engine v1.0
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
