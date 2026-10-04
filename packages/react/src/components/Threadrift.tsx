"use client";

import { useContext, useEffect, useState } from "react";
import { useThreadrift, ThreadriftContext } from "../context/ThreadriftContext";
import { ThreadriftCanvas } from "./ThreadriftCanvas";
import { ThreadriftNavigation } from "./ThreadriftNavigation";


export function Threadrift({ children }: { children?: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const reloadGraph = useThreadrift((s) => s.reloadGraph);
  const store = useContext(ThreadriftContext);

  useEffect(() => {
    if (store?.getState().isLoaded) { setLoading(false); return; }
    let active = true;
    void reloadGraph().then(ok => {
      if (!active) return;
      if (!ok && !store?.getState().isLoaded) setError(store?.getState().saveError ?? "Could not load graph data.");
      setLoading(false);
    });
    return () => { active = false; };
  }, [reloadGraph, store]);

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
