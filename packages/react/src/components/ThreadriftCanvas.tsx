import { memo, useRef, useEffect, useContext } from "react";
import gsap from "gsap";
import { useThreadrift, ThreadriftContext } from "../context/ThreadriftContext";
import type { ThreadriftStore } from "../store/threadrift-store";
import { getRestingNodeIndex } from "../store/navigation";
import { GraphNodeComponent } from "./GraphNode";
import { GraphEdgeComponent } from "./GraphEdge";
import { GraphLabels } from "./GraphLabels";
import { JunctionControls } from "./JunctionControls";
import { CANVAS_SIZE, CAMERA_SCALE, sampleRoute, getNode } from "@threadrift/core";

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
    const position = s.routeGeometry ? sampleRoute(s.routeGeometry, s.scrollCurrent) : { x: 0, y: 0 };
    return Object.values(s.graph.nodes).filter(n => Math.hypot(n.x - position.x, n.y - position.y) <= 2500).map(n => n.id).join(",");
  });
  const visibleNodeIds = new Set(visibleNodeIdsStr.split(",").filter(Boolean).map(Number));
  const nodes = Object.values(graph.nodes).filter(node => visibleNodeIds.has(node.id));
  const activeEdgeIds = new Set(activeEdges.map(edge => edge.id));
  // Active curves can remain visible even when both endpoints are far offscreen.
  const edges = graph.edges.filter(edge => visibleNodeIds.has(edge.from) || visibleNodeIds.has(edge.to) || activeEdgeIds.has(edge.id));

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
      const routePosition = geometry ? sampleRoute(geometry, state.scrollCurrent) : { x: 0, y: 0 };
      const position = routePosition;
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
      apply(store.getState());
    });
    if (wrapperRef.current) observer.observe(wrapperRef.current);
    return () => { unsubscribe(); observer.disconnect(); };
  }, [store, graph, activeEdges, visibleNodeIdsStr, children]);

  // A selection is a recognized tap, never a pointer-down side effect.
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
      if (!state.editorOpen || (state.graphRevision !== previous.graphRevision && !ownDragUpdate.current)) dragCleanup.current?.();
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

  const editNode = (event: React.PointerEvent, id: number) => {
    const state = store.getState();
    if (!state.editorOpen || !event.isPrimary || event.button !== 0) return;
    event.stopPropagation();
    if (state.mergeModeSource !== null && id !== state.mergeModeSource) {
      state.mergeNode(state.mergeModeSource, id);
      state.setMergeMode(null);
      return;
    }
    state.selectNode(id);
    const node = state.graph.nodes[id];
    const matrix = cameraGroupRef.current?.getScreenCTM();
    if (!node || !matrix || matrix.a * matrix.d - matrix.b * matrix.c === 0) return;
    dragCleanup.current?.();
    store.getState().setNodeDragActive(true);
    // Freeze the drag-start frame so camera follow cannot amplify pointer deltas.
    const inverse = matrix.inverse();
    const start = new DOMPoint(event.clientX, event.clientY).matrixTransform(inverse);
    const target = event.currentTarget;
    const pointerId = event.pointerId;
    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      const point = new DOMPoint(next.clientX, next.clientY).matrixTransform(inverse);
      ownDragUpdate.current = true;
      try {
        store.getState().updateNode(id, { x: node.x + point.x - start.x, y: node.y + point.y - start.y });
      } finally { ownDragUpdate.current = false; }
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("pointerdown", additionalPointer, true);
      window.removeEventListener("blur", cleanup);
      window.removeEventListener("resize", cleanup);
      document.removeEventListener("visibilitychange", hidden);
      target.removeEventListener("lostpointercapture", cleanup);
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
      dragCleanup.current = null;
      store.getState().setNodeDragActive(false);
    };
    const finish = (next: PointerEvent) => { if (next.pointerId === pointerId) cleanup(); };
    const additionalPointer = (next: PointerEvent) => { if (next.pointerId !== pointerId) cleanup(); };
    const hidden = () => { if (document.hidden) cleanup(); };
    dragCleanup.current = cleanup;
    target.setPointerCapture(pointerId);
    target.addEventListener("lostpointercapture", cleanup);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("pointerdown", additionalPointer, true);
    window.addEventListener("blur", cleanup);
    window.addEventListener("resize", cleanup);
    document.addEventListener("visibilitychange", hidden);
  };

  return (
    <div ref={wrapperRef} tabIndex={0} role="region" aria-label="Threadrift map. Scroll or swipe to travel; use route controls to choose a path."
      className="absolute inset-0 w-full h-full overflow-hidden outline-offset-[-3px]" style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <svg ref={svgRef} data-threadrift-surface="" className="absolute inset-0 w-full h-full"
        style={{ position: "absolute", width: "100%", height: "100%", touchAction: "pinch-zoom" }}
        viewBox={`0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}`} preserveAspectRatio="xMidYMid slice">
        <g ref={cameraGroupRef} className="will-change-transform">
          {edges.map(edge => <GraphEdgeComponent key={edge.id} edge={edge} sequences={sequences} getNode={id => getNode(graph, id)}
            isActive={activeEdgeIds.has(edge.id)} isSelected={editorOpen && selectedEdge === edge.id}
            onPointerDown={(event, id) => { if (store.getState().editorOpen) { event.stopPropagation(); store.getState().selectEdge(id); } }} />)}
          {nodes.map(node => <GraphNodeComponent key={node.id} node={node} isRoot={node.id === graph.root}
            isActive={activePath.includes(node)} isVisited={visitedNodes.has(node.id)} isSelected={editorOpen && selectedNode === node.id}
            isMergeTarget={editorOpen && mergeModeSource !== null && node.id !== mergeModeSource} onPointerDown={editNode} />)}
          <GraphLabels nodes={activePath} />
        </g>
      </svg>
      <div ref={contentRef} data-threadrift-content="" style={{ position: "absolute", left: 0, top: 0, width: 0,
        height: 0, pointerEvents: "none", transformOrigin: "0 0" }}>{children}</div>
      <JunctionControls />
    </div>
  );
});
export const GraphCanvas = ThreadriftCanvas;
