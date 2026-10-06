import { memo, useRef, useEffect, useContext, useMemo, useState } from "react";
import gsap from "gsap";
import { useThreadrift, ThreadriftContext } from "../context/ThreadriftContext";
import type { ThreadriftStore } from "../store/threadrift-store";
import { getRestingNodeIndex } from "../store/navigation";
import { GraphNodeComponent } from "./GraphNode";
import { GraphEdgeComponent } from "./GraphEdge";
import { GraphLabels } from "./GraphLabels";
import { JunctionControls } from "./JunctionControls";
import { CANVAS_SIZE, CAMERA_SCALE, getNode, getNodeEditCapabilities, type Point } from "@threadrift/core";
import { resolveCamera } from "../store/camera-state";
import { edgeBounds, overlaps, viewBounds } from "./viewport";

export const ThreadriftCanvas = memo(function ThreadriftCanvas({ children }: { children?: React.ReactNode }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const cameraGroupRef = useRef<SVGGElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const dragCleanup = useRef<(() => void) | null>(null);
  const ownDragUpdate = useRef(false);
  const store = useContext(ThreadriftContext);
  if (!store) throw new Error("Canvas must be inside Threadrift.Root");
  const graph = useThreadrift(s => s.graph);
  const sequences = useThreadrift(s => s.sequences);
  const activePath = useThreadrift(s => s.activePath);
  const activeEdges = useThreadrift(s => s.activeEdges);
  const visitedNodes = useThreadrift(s => s.visitedNodes);
  const editorOpen = useThreadrift(s => s.editorOpen);
  const selectedNode = useThreadrift(s => s.selectedNode);
  const selectedEdge = useThreadrift(s => s.selectedEdge);
  const mergeModeSource = useThreadrift(s => s.mergeModeSource);
  const cameraMode = useThreadrift(s => s.cameraMode);
  const mergeTargets = useMemo(() => new Set(mergeModeSource === null ? [] : getNodeEditCapabilities(graph, mergeModeSource).mergeTargets), [graph, mergeModeSource]);
  const [size, setSize] = useState({ width: 1000, height: 1000 });
  const curveBounds = useMemo(() => edgeBounds(graph, sequences), [graph, sequences]);
  const touchAction = useThreadrift(s => {
    if (s.editorOpen) return "pinch-zoom";
    const rest = getRestingNodeIndex(s);
    if (rest === null) return "pinch-zoom";
    const terminal = !s.graph.edges.some(edge => edge.from === s.activePath[rest]?.id);
    if (rest === 0 && terminal) return "pan-y pinch-zoom";
    if (rest === 0) return "pan-up pinch-zoom";
    if (terminal) return "pan-down pinch-zoom";
    return "pinch-zoom";
  });
  const visibleNodeIdsStr = useThreadrift(s => {
    const bounds = viewBounds(resolveCamera(s), size.width, size.height);
    return Object.values(s.graph.nodes).filter(n => (s.nodeDragActive && n.id === s.selectedNode) ||
      (n.x >= bounds.left && n.x <= bounds.right && n.y >= bounds.top && n.y <= bounds.bottom)).map(n => n.id).join(",");
  });
  const visibleEdgesStr = useThreadrift(s => {
    const bounds = viewBounds(resolveCamera(s), size.width, size.height);
    return JSON.stringify(s.graph.edges.filter(edge => {
      const curve = curveBounds.get(edge.id);
      return !curve || overlaps(curve, bounds);
    }).map(edge => edge.id));
  });
  const visibleNodeIds = new Set(visibleNodeIdsStr.split(",").filter(Boolean).map(Number));
  const nodes = Object.values(graph.nodes).filter(node => visibleNodeIds.has(node.id));
  const activeEdgeIds = new Set(activeEdges.map(edge => edge.id));
  const visibleEdgeIds = new Set<string>(JSON.parse(visibleEdgesStr));
  const edges = graph.edges.filter(edge => visibleEdgeIds.has(edge.id));

  useEffect(() => {
    const element = wrapperRef.current!;
    store.getState().setNavigationElement(element);
    return () => {
      dragCleanup.current?.();
      if (store.getState().navigationElement === element) store.getState().setNavigationElement(null);
    };
  }, [store]);

  useEffect(() => {
    if (svgRef.current) svgRef.current.style.touchAction = typeof CSS !== "undefined" && CSS.supports("touch-action", touchAction) ? touchAction : "pinch-zoom";
  }, [touchAction]);

  useEffect(() => {
    const apply = (state: ThreadriftStore) => {
      const geometry = state.routeGeometry;
      const position = resolveCamera(state);
      const x = CANVAS_SIZE / 2 - position.x * CAMERA_SCALE;
      const y = CANVAS_SIZE / 2 - position.y * CAMERA_SCALE;
      if (cameraGroupRef.current) gsap.set(cameraGroupRef.current, { x, y, scale: CAMERA_SCALE, svgOrigin: "0 0" });
      if (contentRef.current && wrapperRef.current) {
        // Local CSS transforms use layout dimensions; screen bounds would apply
        // an ancestor's CSS scale twice to the HTML layer.
        const width = wrapperRef.current.clientWidth;
        const height = wrapperRef.current.clientHeight;
        const scale = Math.max(width, height) / CANVAS_SIZE;
        const offsetX = (width - CANVAS_SIZE * scale) / 2;
        const offsetY = (height - CANVAS_SIZE * scale) / 2;
        // Project anchor positions into local screen pixels without scaling their content.
        contentRef.current.style.setProperty("--threadrift-world-scale", String(CAMERA_SCALE * scale));
        contentRef.current.style.transform = `translate(${offsetX + x * scale}px, ${offsetY + y * scale}px)`;
      }
      const byId = new Map(geometry?.edges.map((edge, index) => [edge.id, { edge, index }]));
      svgRef.current?.querySelectorAll<SVGPathElement>("[data-threadrift-edge-fill]").forEach(path => {
        const item = byId.get(path.dataset.threadriftEdgeFill ?? "");
        if (!item) { path.style.strokeDasharray = "0 1"; return; }
        const fraction = Math.max(0, Math.min(1, state.scrollCurrent - item.index));
        path.style.strokeDasharray = `${fraction * item.edge.length} ${item.edge.length}`;
      });
    };
    apply(store.getState());
    const unsubscribe = store.subscribe(apply);
    let previousWidth = wrapperRef.current?.clientWidth;
    let previousHeight = wrapperRef.current?.clientHeight;
    const observer = new ResizeObserver(() => {
      const width = wrapperRef.current?.clientWidth;
      const height = wrapperRef.current?.clientHeight;
      if (width !== previousWidth || height !== previousHeight) dragCleanup.current?.();
      previousWidth = width;
      previousHeight = height;
      if (width !== undefined && height !== undefined) setSize(old => old.width === width && old.height === height ? old : { width, height });
      apply(store.getState());
    });
    if (wrapperRef.current) observer.observe(wrapperRef.current);
    return () => { unsubscribe(); observer.disconnect(); };
  }, [store, graph, activeEdges, visibleNodeIdsStr, visibleEdgesStr, children]);

  // Only a completed blank-surface tap clears editor selection; swipes retain it.
  useEffect(() => {
    const element = wrapperRef.current!;
    let tap: { id: number; x: number; y: number } | null = null;
    const clear = () => { tap = null; };
    const blank = (target: EventTarget | null) => target instanceof Element &&
      !!target.closest("[data-threadrift-surface]") &&
      !target.closest("[data-threadrift-node], [data-threadrift-edge], [data-threadrift-controls], [data-threadrift-content]");
    const down = (event: PointerEvent) => {
      const state = store.getState();
      if (tap) { clear(); return; }
      if (state.editorOpen && state.cameraMode !== "position" && state.mergeModeSource === null &&
        event.isPrimary && event.button === 0 && !event.ctrlKey && !event.metaKey && blank(event.target)) {
        tap = { id: event.pointerId, x: event.clientX, y: event.clientY };
      }
    };
    const move = (event: PointerEvent) => {
      if (tap?.id === event.pointerId && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) >= 8) clear();
    };
    const up = (event: PointerEvent) => {
      const pending = tap;
      clear();
      const state = store.getState();
      if (pending?.id === event.pointerId && !event.defaultPrevented && blank(event.target) &&
        Math.hypot(event.clientX - pending.x, event.clientY - pending.y) < 8 &&
        state.editorOpen && state.cameraMode !== "position" && state.mergeModeSource === null) state.selectNode(null);
    };
    const other = (event: PointerEvent) => { if (tap && tap.id !== event.pointerId) clear(); };
    element.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerdown", other, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", clear, true);
    window.addEventListener("blur", clear);
    window.addEventListener("resize", clear);
    return () => {
      element.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerdown", other, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", clear, true);
      window.removeEventListener("blur", clear);
      window.removeEventListener("resize", clear);
    };
  }, [store]);

  // A visitor route selection is a recognized tap, never a pointer-down side effect.
  useEffect(() => {
    const element = wrapperRef.current!;
    let tap: { pointer: number; x: number; y: number; target: Element; revision: number; node?: number; edge?: string } | null = null;
    const clear = () => { tap = null; };
    const down = (event: PointerEvent) => {
      if (tap && tap.pointer !== event.pointerId) clear();
      if (!event.isPrimary || event.button !== 0 || event.ctrlKey || event.metaKey || getRestingNodeIndex(store.getState()) === null) return;
      const target = event.target instanceof Element ? event.target.closest("[data-threadrift-node], [data-threadrift-edge]") : null;
      if (!target || !element.contains(target) || target.closest("[data-threadrift-content], [data-threadrift-controls]")) return;
      const node = target.getAttribute("data-threadrift-node");
      tap = { pointer: event.pointerId, x: event.clientX, y: event.clientY, target, revision: store.getState().graphRevision,
        node: node === null ? undefined : Number(node), edge: target.getAttribute("data-threadrift-edge") ?? undefined };
    };
    const otherDown = (event: PointerEvent) => { if (tap && event.pointerId !== tap.pointer) clear(); };
    const move = (event: PointerEvent) => {
      if (tap?.pointer === event.pointerId && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) >= 8) clear();
    };
    const up = (event: PointerEvent) => {
      const pending = tap;
      if (!pending || pending.pointer !== event.pointerId) return;
      clear();
      const state = store.getState();
      const target = event.target instanceof Element ? event.target.closest("[data-threadrift-node], [data-threadrift-edge]") : null;
      if (event.defaultPrevented || pending.revision !== state.graphRevision || target !== pending.target ||
        Math.hypot(event.clientX - pending.x, event.clientY - pending.y) >= 8 || getRestingNodeIndex(state) === null) return;
      if (pending.node !== undefined) state.focusNode(pending.node);
      else if (pending.edge !== undefined) state.focusEdge(pending.edge);
    };
    const visibility = () => { if (document.hidden) clear(); };
    const unsubscribe = store.subscribe((state, previous) => {
      if (state.graphRevision !== previous.graphRevision || getRestingNodeIndex(state) === null) clear();
      if (!state.editorOpen || state.cameraMode !== previous.cameraMode ||
        (state.graphRevision !== previous.graphRevision && !ownDragUpdate.current)) dragCleanup.current?.();
    });
    element.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerdown", otherDown, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", clear, true);
    window.addEventListener("blur", clear);
    element.addEventListener("lostpointercapture", clear);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      unsubscribe();
      element.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerdown", otherDown, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", clear, true);
      window.removeEventListener("blur", clear);
      element.removeEventListener("lostpointercapture", clear);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [store]);

  const startDrag = (event: React.PointerEvent, movePoint: (delta: Point) => void, complete: (commit: boolean) => void) => {
    const matrix = cameraGroupRef.current?.getScreenCTM();
    if (!matrix || matrix.a * matrix.d - matrix.b * matrix.c === 0) { complete(false); return; }
    const inverse = matrix.inverse();
    const start = new DOMPoint(event.clientX, event.clientY).matrixTransform(inverse);
    const target = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX, startY = event.clientY;
    let moved = false, finished = false;
    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      if (!moved && Math.hypot(next.clientX - startX, next.clientY - startY) < 4) return;
      moved = true;
      const point = new DOMPoint(next.clientX, next.clientY).matrixTransform(inverse);
      ownDragUpdate.current = true;
      try {
        movePoint({ x: point.x - start.x, y: point.y - start.y });
      } finally { ownDragUpdate.current = false; }
    };
    const cleanup = (commit = false) => {
      if (finished) return;
      finished = true;
      dragCleanup.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancelPointer);
      window.removeEventListener("pointerdown", additionalPointer, true);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("resize", cancel);
      window.removeEventListener("keydown", key, true);
      document.removeEventListener("visibilitychange", hidden);
      target.removeEventListener("lostpointercapture", cancel);
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
      complete(commit && moved);
    };
    const cancel = () => cleanup(false);
    const cancelPointer = (next: PointerEvent) => { if (next.pointerId === pointerId) cancel(); };
    const finish = (next: PointerEvent) => { if (next.pointerId === pointerId) { move(next); cleanup(true); } };
    const additionalPointer = (next: PointerEvent) => { if (next.pointerId !== pointerId) cancel(); };
    const hidden = () => { if (document.hidden) cancel(); };
    const key = (next: KeyboardEvent) => { if (next.key === "Escape") { next.preventDefault(); next.stopPropagation(); cancel(); } };
    dragCleanup.current = cancel;
    try { target.setPointerCapture(pointerId); } catch { cancel(); return; }
    target.addEventListener("lostpointercapture", cancel);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancelPointer);
    window.addEventListener("pointerdown", additionalPointer, true);
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", cancel);
    window.addEventListener("keydown", key, true);
    document.addEventListener("visibilitychange", hidden);
  };

  const editNode = (event: React.PointerEvent, id: number) => {
    const state = store.getState();
    if (!state.editorOpen || state.cameraMode === "position" || !event.isPrimary || event.button !== 0 || event.ctrlKey || event.metaKey) return;
    event.stopPropagation();
    dragCleanup.current?.();
    if (state.mergeModeSource !== null && id !== state.mergeModeSource) {
      if (!getNodeEditCapabilities(state.graph, state.mergeModeSource).mergeTargets.includes(id)) return;
      state.mergeNode(state.mergeModeSource, id); state.setMergeMode(null); return;
    }
    state.selectNode(id);
    const node = store.getState().graph.nodes[id];
    const token = store.getState().beginNodeEdit(id);
    if (!node || token === null) return;
    startDrag(event, delta => store.getState().previewNodePosition(token, { x: node.x + delta.x, y: node.y + delta.y }),
      commit => store.getState().finishNodeEdit(token, commit));
  };

  const positionCamera = (event: React.PointerEvent) => {
    const state = store.getState();
    if (!state.editorOpen || state.cameraMode !== "position" || !event.isPrimary || event.button !== 0 || event.ctrlKey || event.metaKey) return;
    event.stopPropagation();
    dragCleanup.current?.();
    const start = { ...resolveCamera(store.getState()) };
    startDrag(event, delta => store.getState().moveCameraPreview({ x: start.x - delta.x, y: start.y - delta.y }),
      commit => { if (!commit) store.getState().moveCameraPreview(start); });
  };

  return (
    <div ref={wrapperRef} tabIndex={0} role="region" aria-label="Threadrift map. Scroll or swipe to travel; use route controls to choose a path."
      className="absolute inset-0 w-full h-full overflow-hidden outline-offset-[-3px]" style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <svg ref={svgRef} data-threadrift-surface="" className="absolute inset-0 w-full h-full" onPointerDownCapture={positionCamera}
        style={{ position: "absolute", width: "100%", height: "100%", touchAction: "pinch-zoom", cursor: cameraMode === "position" ? "grab" : undefined }}
        viewBox={`0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}`} preserveAspectRatio="xMidYMid slice">
        <g ref={cameraGroupRef} data-threadrift-camera="" className="will-change-transform">
          {edges.map(edge => <GraphEdgeComponent key={edge.id} edge={edge} sequences={sequences} getNode={id => getNode(graph, id)}
            isActive={activeEdgeIds.has(edge.id)} isSelected={editorOpen && selectedEdge === edge.id}
            onPointerDown={(event, id) => { if (store.getState().editorOpen) { event.stopPropagation(); store.getState().selectEdge(id); } }} />)}
          {nodes.map(node => <GraphNodeComponent key={node.id} node={node} isRoot={node.id === graph.root}
            isActive={activePath.includes(node)} isVisited={visitedNodes.has(node.id)} isSelected={editorOpen && selectedNode === node.id}
            isMergeTarget={editorOpen && mergeTargets.has(node.id)} onPointerDown={editNode} />)}
          <GraphLabels nodes={activePath} />
          {editorOpen && selectedNode !== null && graph.nodes[selectedNode]?.camera && (() => {
            const node = graph.nodes[selectedNode], view = node.camera!;
            return <g data-threadrift-view-guide="" pointerEvents="none" opacity={.65} stroke="oklch(.8 .11 230)" strokeWidth={1}>
              <path d={`M ${node.x} ${node.y} L ${view.x} ${view.y}`} strokeDasharray="4 5" />
              <path d={`M ${view.x - 10} ${view.y} h 20 M ${view.x} ${view.y - 10} v 20`} />
            </g>;
          })()}
        </g>
      </svg>
      <div ref={contentRef} data-threadrift-content="" style={{ position: "absolute", left: 0, top: 0, width: 0,
        height: 0, pointerEvents: "none", transformOrigin: "0 0" }}>{children}</div>
      <JunctionControls />
    </div>
  );
});
export const GraphCanvas = ThreadriftCanvas;
