"use client";

import { useEffect, useState } from "react";
import { useThreadrift } from "../context/ThreadriftContext";
import { ThreadriftCanvas } from "./ThreadriftCanvas";
import { ThreadriftNavigation } from "./ThreadriftNavigation";
import type { GraphJSON } from "@threadrift/core";

export function Threadrift({ children }: { children?: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const loadGraph = useThreadrift((s) => s.loadGraph);

  useEffect(() => {
    async function fetchGraph() {
      try {
        let data: GraphJSON | null = null;
        
        // Try fetching from real-time API route first
        try {
          const apiRes = await fetch("/api/graph", { cache: "no-store" });
          if (apiRes.ok) {
            data = await apiRes.json();
          }
        } catch {
          // Fallback to static public json
        }

        if (!data) {
          const res = await fetch("/data/graph.json", { cache: "no-store" });
          if (!res.ok) throw new Error("Failed to load Threadrift graph data");
          data = await res.json();
        }

        if (data) {
          loadGraph(data);
          setLoading(false);
        }
      } catch (err) {
        console.error("Error loading Threadrift graph:", err);
        // Last resort: check localStorage backup
        try {
          const backup = localStorage.getItem("threadrift-graph-backup");
          if (backup) {
            loadGraph(JSON.parse(backup));
            setLoading(false);
            return;
          }
        } catch { /* ignore */ }

        setError("Could not load Threadrift graph data.");
        setLoading(false);
      }
    }

    fetchGraph();
  }, [loadGraph]);

  if (error) {
    return (
      <div className="w-full h-screen flex items-center justify-center bg-zinc-950 text-red-500 font-mono text-sm">
        {error}
      </div>
    );
  }

  return (
    <div className="absolute inset-0 w-full h-full pointer-events-none">
      
      {/* Subtle background gradient */}
      <div 
        className="absolute inset-0 w-full h-full pointer-events-none mix-blend-screen"
        style={{
          background: "radial-gradient(circle at 50% 50%, rgba(56, 189, 248, 0.05) 0%, transparent 60%)"
        }}
      />

      <div className="absolute inset-0 w-full h-full overflow-hidden pointer-events-none">
        {/* Canvas container with pointer-events-auto for node interaction */}
        <div className="absolute inset-0 w-full h-full pointer-events-auto">
          {!loading && (
            <>
              <ThreadriftNavigation />
              <ThreadriftCanvas>
                {children}
              </ThreadriftCanvas>
            </>
          )}
        </div>
        
        {/* Loading State Overlay */}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm z-50">
            <div className="text-zinc-500 text-xs animate-pulse tracking-widest uppercase font-mono">
              Initializing Threadrift Engine...
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
