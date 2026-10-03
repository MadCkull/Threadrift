import { memo, useRef, useEffect, useContext } from "react";
import gsap from "gsap";
import { useThreadrift, ThreadriftContext } from "../context/ThreadriftContext";
import type { ThreadriftStore } from "../store/threadrift-store";
import { GraphNodeComponent } from "./GraphNode";
import { GraphEdgeComponent } from "./GraphEdge";
import { GraphLabels } from "./GraphLabels";
import { CANVAS_SIZE, CAMERA_SCALE } from "@threadrift/core";
import { getPathLength } from "@threadrift/core";
import { getNode } from "@threadrift/core";
import { interpolatePosition } from "@threadrift/core";

export const ThreadriftCanvas = memo(function ThreadriftCanvas({
  children,
}: {
  children?: React.ReactNode;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const cameraGroupRef = useRef<SVGGElement>(null);

  const store = useContext(ThreadriftContext);
  if (!store) throw new Error("Canvas must be inside Threadrift.Root");

  // Zustand state subscriptions (only things that should trigger a React re-render)
  const graph = useThreadrift((s) => s.graph);
  const sequences = useThreadrift((s) => s.sequences);
  const activePath = useThreadrift((s) => s.activePath);
  const visitedNodes = useThreadrift((s) => s.visitedNodes);
  const selectNode = useThreadrift((s) => s.selectNode);
  const focusNode = useThreadrift((s) => s.focusNode);
  const focusEdge = useThreadrift((s) => s.focusEdge);
  const selectEdge = useThreadrift((s) => s.selectEdge);
  const editorOpen = useThreadrift((s) => s.editorOpen);
  const selectedNode = useThreadrift((s) => s.selectedNode);
  const selectedEdge = useThreadrift((s) => s.selectedEdge);
  const mergeModeSource = useThreadrift((s) => s.mergeModeSource);
  const setMergeMode = useThreadrift((s) => s.setMergeMode);
  const mergeNode = useThreadrift((s) => s.mergeNode);

  // CULLING: Return a string of visible node IDs.
  // This selector runs at 60fps but only triggers a React re-render when a node enters/leaves the radius.
  const visibleNodeIdsStr = useThreadrift((s) => {
    const targetPos = interpolatePosition(s.activePath, s.scrollCurrent);
    return Object.values(s.graph.nodes)
      .filter((n) => Math.hypot(n.x - targetPos.x, n.y - targetPos.y) <= 2500)
      .map((n) => n.id)
      .join(",");
  });

  const visibleNodeIds = new Set(visibleNodeIdsStr.split(",").map(Number));

  // Only render nodes that are visible
  const nodesArray = Object.values(graph.nodes).filter((n) => visibleNodeIds.has(n.id));
  
  // Edges are visible if either their 'from' or 'to' node is visible
  const edgesArray = graph.edges.filter(
    (e) => visibleNodeIds.has(e.from) || visibleNodeIds.has(e.to)
  );

  // ── GSAP Animation Loop (Bypassing React) ────────────────
  
  useEffect(() => {
    const applyGSAP = (state: ThreadriftStore) => {
      const scrollCurrent = state.scrollCurrent;
      const currentActivePath = state.activePath;
      const currentEdgesArray = state.graph.edges;

      // 1. Camera Animation
      if (cameraGroupRef.current) {
        const targetPos = interpolatePosition(currentActivePath, scrollCurrent);
        const cx = CANVAS_SIZE / 2 - targetPos.x * CAMERA_SCALE;
        const cy = CANVAS_SIZE / 2 - targetPos.y * CAMERA_SCALE;

        const transformOptions = {
          x: cx,
          y: cy,
          scale: CAMERA_SCALE,
          svgOrigin: "0 0",
        };

        gsap.set(cameraGroupRef.current, transformOptions);
      }

      // 2. Edge Masking
      if (svgRef.current) {
        currentActivePath.forEach((node, i: number) => {
          const nextNode = currentActivePath[i + 1];
          if (!nextNode) return;

          const activeEdge = currentEdgesArray.find(
            (e) => e.from === node.id && e.to === nextNode.id
          );
          if (!activeEdge) return;

          const pathEl = svgRef.current?.querySelector<SVGPathElement>(
            `#edge-${activeEdge.id}`
          );
          if (!pathEl) return;

          const pathData = pathEl.getAttribute("d");
          if (!pathData) return;

          const len = getPathLength(activeEdge.id, pathData);
          
          const edgeStartScroll = i;
          const edgeEndScroll = i + 1;
          let progress = 0;

          if (scrollCurrent >= edgeEndScroll) progress = 1;
          else if (scrollCurrent <= edgeStartScroll) progress = 0;
          else progress = scrollCurrent - edgeStartScroll;

          const drawLength = progress * len;

          gsap.set(pathEl, {
            strokeDasharray: `${drawLength} ${len}`,
          });
        });
      }
    };

    // Apply immediately on mount
    applyGSAP(store.getState());

    // Subscribe to store changes for 60fps updates without re-rendering React
    const unsubscribe = store.subscribe(applyGSAP);

    return unsubscribe;
  }, [store]);

  return (
    <div className="absolute inset-0 w-full h-full pointer-events-none overflow-hidden">
      <svg
        ref={svgRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
        viewBox={`0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}`}
        preserveAspectRatio="xMidYMid slice"
      >
        <g ref={cameraGroupRef} className="will-change-transform">
          {/* Render Edges */}
          {edgesArray.map((edge) => {
            // Check if edge is part of the active path
            const isActive = activePath.some((n, i) => {
              const next = activePath[i + 1];
              return next && n.id === edge.from && next.id === edge.to;
            });

            return (
              <GraphEdgeComponent
                key={edge.id}
                edge={edge}
                sequences={sequences}
                getNode={(id) => getNode(graph, id)}
                isActive={isActive}
                isSelected={editorOpen && selectedEdge === edge.id}
                onPointerDown={(e, id) => {
                  e.stopPropagation();
                  if (editorOpen) {
                    selectEdge(id);
                  } else {
                    focusEdge(id);
                  }
                }}
              />
            );
          })}

          {/* Render Nodes */}
          {nodesArray.map((node) => (
            <GraphNodeComponent
              key={node.id}
              node={node}
              isRoot={node.id === graph.root}
              isActive={activePath.includes(node)}
              isVisited={visitedNodes.has(node.id)}
              isSelected={editorOpen && selectedNode === node.id}
              isMergeTarget={mergeModeSource !== null && node.id !== mergeModeSource}
              onPointerDown={(e, id) => {
                e.stopPropagation();
                if (mergeModeSource !== null && id !== mergeModeSource) {
                  // Execute merge
                  mergeNode(mergeModeSource, id);
                  setMergeMode(null);
                } else {
                  if (editorOpen) {
                    selectNode(id);
                    
                    // Setup dragging
                    const targetNode = graph.nodes[id];
                    if (targetNode) {
                      const startX = e.clientX;
                      const startY = e.clientY;
                      const initialNodeX = targetNode.x;
                      const initialNodeY = targetNode.y;
                      
                      const onMove = (moveEvent: PointerEvent) => {
                        // The scale is CAMERA_SCALE, so movement in screen space
                        // must be divided by CAMERA_SCALE to get canvas space movement
                        const dx = (moveEvent.clientX - startX) / CAMERA_SCALE;
                        const dy = (moveEvent.clientY - startY) / CAMERA_SCALE;
                        store.getState().updateNode(id, { x: initialNodeX + dx, y: initialNodeY + dy });
                      };
                      
                      const onUp = () => {
                        window.removeEventListener('pointermove', onMove);
                        window.removeEventListener('pointerup', onUp);
                      };
                      
                      window.addEventListener('pointermove', onMove);
                      window.addEventListener('pointerup', onUp);
                    }
                  } else {
                    focusNode(id);
                  }
                }
              }}
            />
          ))}

          {/* Render Floating Labels */}
          <GraphLabels nodes={activePath} />

          {/* HTML Spatial Layer (perfectly aligned via foreignObject) */}
          {children && (
            <foreignObject
              x={0}
              y={0}
              width={1}
              height={1}
              className="pointer-events-none"
              style={{ overflow: "visible" }}
            >
              <div className="absolute w-full h-full">
                {children}
              </div>
            </foreignObject>
          )}
        </g>
      </svg>
    </div>
  );
});
export const GraphCanvas = ThreadriftCanvas;
