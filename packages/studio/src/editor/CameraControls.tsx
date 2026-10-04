"use client";

import { useEffect, useRef, useState } from "react";
import { useThreadrift, useThreadriftApi, resolveCamera } from "@threadrift/react";
import { CAMERA_COORDINATE_LIMIT, nodeCamera } from "@threadrift/core";
import { Camera, Hand, LockKeyhole, Play, RotateCcw } from "lucide-react";

const button = "flex items-center justify-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400 disabled:opacity-40";

/** Commit a complete numeric value on Enter/blur; Escape restores the last value. */
export function CommitNumber({ label, value, onCommit, min, max, step = 1 }: {
  label: string; value: number; onCommit: (value: number) => void; min?: number; max?: number; step?: number;
}) {
  const [draft, setDraft] = useState(String(value));
  const committed = useRef(value);
  committed.current = value;
  useEffect(() => setDraft(String(value)), [value]);
  const commit = (raw: string) => {
    const number = Number(raw);
    if (raw.trim() && Number.isFinite(number) && (min === undefined || number >= min) && (max === undefined || number <= max)) {
      if (number !== committed.current) onCommit(number);
    }
    // Parent validation may reject a cross-field value (e.g. start >= end).
    // Revert locally; accepted parent updates then supply the new value.
    setDraft(String(committed.current));
  };
  return <label className="flex min-w-0 flex-col gap-1 text-xs text-zinc-400">
    <span>{label}</span>
    <input aria-label={label} type="number" value={draft} min={min} max={max} step={step}
      onChange={event => setDraft(event.target.value)} onBlur={event => commit(event.currentTarget.value)}
      onKeyDown={event => {
        if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setDraft(String(value)); }
      }} className="w-full rounded-md border border-white/10 bg-zinc-900 px-2 py-2 text-zinc-100 focus:outline-sky-400" />
  </label>;
}

export function CameraToolbar() {
  const mode = useThreadrift(s => s.cameraMode);
  const setMode = useThreadrift(s => s.setCameraMode);
  const error = useThreadrift(s => s.graphError);
  const notice = useThreadrift(s => s.editorNotice);
  const nodes = useThreadrift(s => s.graph.nodes);
  const selected = useThreadrift(s => s.selectedNode);
  const select = useThreadrift(s => s.selectNode);
  return <div className="border-b border-white/5 px-4 py-3" data-threadrift-controls="">
    <div className="flex gap-2">
      <button type="button" aria-label="Freeze camera" title="Freeze camera while moving nodes" aria-pressed={mode === "freeze"}
        onClick={() => setMode(mode === "freeze" ? "follow" : "freeze")}
        className={`${button} min-h-11 flex-1 ${mode === "freeze" ? "bg-sky-500/15 text-sky-200" : ""}`}>
        <LockKeyhole size={16} aria-hidden="true" />Freeze
      </button>
      <button type="button" aria-label="Position camera" title="Drag the map to compose a view" aria-pressed={mode === "position"}
        onClick={() => setMode(mode === "position" ? "follow" : "position")}
        className={`${button} min-h-11 flex-1 ${mode === "position" ? "bg-sky-500/15 text-sky-200" : ""}`}>
        <Hand size={16} aria-hidden="true" />Set view
      </button>
    </div>
    {mode !== "follow" && <div className="mt-2 flex flex-col gap-2">
      <p role="status" className="text-xs leading-relaxed text-zinc-400">{mode === "freeze" ? "View frozen. Moving a node saves this view with it." :
        mode === "position" ? "Drag the map to frame your view, then use current view on the selected node." : "Previewing a node view. Route travel is paused."}</p>
      <label className="flex flex-col gap-1 text-xs text-zinc-400">View destination
        <select aria-label="View destination" value={selected ?? ""} onChange={event => select(Number(event.target.value))}
          className="min-w-0 rounded-md border border-white/10 bg-zinc-900 px-2 py-2 text-zinc-100">
          {selected === null && <option value="" disabled>Choose a node</option>}
          {Object.values(nodes).map(node => <option key={node.id} value={node.id}>{node.name || "Node"} · {node.id}</option>)}
        </select>
      </label>
      <button type="button" className={button} onClick={() => setMode("follow")}><Play size={14} aria-hidden="true" />Return to route</button>
    </div>}
    {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
    {notice && <p role="status" className="mt-2 text-xs text-zinc-400">{notice}</p>}
  </div>;
}

export function NodeCameraControls({ id }: { id: number }) {
  const node = useThreadrift(s => s.graph.nodes[id]);
  const setCamera = useThreadrift(s => s.setNodeCamera);
  const preview = useThreadrift(s => s.previewNodeCamera);
  const capture = useThreadrift(s => s.captureNodeCamera);
  const x = useThreadrift(s => resolveCamera(s).x);
  const y = useThreadrift(s => resolveCamera(s).y);
  if (!node) return null;
  const camera = nodeCamera(node);
  const edit = (axis: "x" | "y", value: number) => { setCamera(id, { ...camera, [axis]: value }); preview(id); };
  return <section className="flex flex-col gap-3" aria-label="Node camera">
    <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-zinc-400"><Camera size={14} aria-hidden="true" />Camera · {node.camera ? "Saved view" : "Follow node"}</div>
    <p className="text-xs text-zinc-500">View for {node.name || `Node ${id}`}. Saved centers stay fixed when the node moves.</p>
    <div className="grid grid-cols-2 gap-3">
      <CommitNumber label="Camera X" value={camera.x} onCommit={value => edit("x", value)} min={-CAMERA_COORDINATE_LIMIT} max={CAMERA_COORDINATE_LIMIT} />
      <CommitNumber label="Camera Y" value={camera.y} onCommit={value => edit("y", value)} min={-CAMERA_COORDINATE_LIMIT} max={CAMERA_COORDINATE_LIMIT} />
    </div>
    <button type="button" className={button} onClick={() => capture(id)}><Camera size={14} aria-hidden="true" />Use current view</button>
    <span className="text-[11px] text-zinc-500">Current center: {x.toFixed(1)}, {y.toFixed(1)}</span>
    <div className="grid grid-cols-2 gap-2">
      <button type="button" className={button} onClick={() => preview(id)}><Play size={14} aria-hidden="true" />Preview view</button>
      <button type="button" className={button} disabled={!node.camera} onClick={() => { setCamera(id, undefined); preview(id); }}><RotateCcw size={14} aria-hidden="true" />Reset to Follow</button>
    </div>
  </section>;
}

export function NodePositionControls({ id }: { id: number }) {
  const node = useThreadrift(s => s.graph.nodes[id]);
  const positioning = useThreadrift(s => s.cameraMode === "position");
  const { store } = useThreadriftApi();
  const token = useRef<number | null>(null);
  const pointer = useRef<number | null>(null);
  const finish = (commit: boolean) => {
    const current = token.current;
    token.current = null;
    if (current !== null) store.getState().finishNodeEdit(current, commit);
  };
  useEffect(() => {
    const up = (event: PointerEvent) => { if (event.pointerId === pointer.current) { finish(true); pointer.current = null; } };
    const cancel = () => finish(false);
    const cancelled = (event: PointerEvent) => { if (event.pointerId === pointer.current) { cancel(); pointer.current = null; } };
    const additional = (event: PointerEvent) => { if (pointer.current !== null && event.pointerId !== pointer.current) cancel(); };
    const hidden = () => { if (document.hidden) cancel(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape" && token.current !== null) { event.preventDefault(); cancel(); } };
    window.addEventListener("pointerup", up, true); window.addEventListener("pointercancel", cancelled, true); window.addEventListener("pointerdown", additional, true);
    window.addEventListener("blur", cancel); window.addEventListener("resize", cancel); window.addEventListener("keydown", key);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("pointerup", up, true); window.removeEventListener("pointercancel", cancelled, true); window.removeEventListener("pointerdown", additional, true);
      window.removeEventListener("blur", cancel); window.removeEventListener("resize", cancel); window.removeEventListener("keydown", key);
      document.removeEventListener("visibilitychange", hidden); cancel();
    };
  }, [store, id]);
  if (!node) return null;
  const change = (axis: "x" | "y", value: number) => {
    if (token.current !== null) store.getState().previewNodePosition(token.current, { x: node.x, y: node.y, [axis]: value });
    else if (pointer.current === null) store.getState().updateNode(id, { [axis]: value });
  };
  return <fieldset disabled={positioning} className="flex flex-col gap-3 disabled:opacity-40" aria-label="Node position">
    <span className="text-xs uppercase tracking-wider text-zinc-500">Position</span>
    <div className="grid grid-cols-2 gap-3">{(["x", "y"] as const).map(axis => <div key={axis} className="flex flex-col gap-2">
      <input type="range" aria-label={`Node ${axis.toUpperCase()} slider`} min={Math.min(20, node[axis])} max={Math.max(1500, node[axis])} value={node[axis]}
        onPointerDown={event => {
          if (!event.isPrimary || event.button !== 0) return;
          pointer.current = event.pointerId; token.current = store.getState().beginNodeEdit(id);
        }} onLostPointerCapture={event => { if (event.buttons !== 0) finish(false); }}
        onChange={event => change(axis, Number(event.target.value))} className="w-full accent-white" />
      <CommitNumber label={`Node ${axis.toUpperCase()}`} value={node[axis]} onCommit={value => store.getState().updateNode(id, { [axis]: value })} />
    </div>)}</div>
  </fieldset>;
}
