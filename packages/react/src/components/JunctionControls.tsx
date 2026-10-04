import { useContext, useEffect, useId, useRef, useState } from "react";
import { ThreadriftContext, useThreadrift } from "../context/ThreadriftContext";
import { getRestingNodeIndex } from "../store/navigation";

const hidden: React.CSSProperties = { position: "absolute", width: 1, height: 1, padding: 0,
  margin: -1, overflow: "hidden", clipPath: "inset(50%)", whiteSpace: "nowrap", border: 0 };

function Icon({ kind }: { kind: "previous" | "next" | "routes" }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "routes" ? <><path d="M12 20V10M12 14C12 7 5 12 5 4M12 14C12 7 19 12 19 4" /><path d="m2 7 3-3 3 3m8 0 3-3 3 3" /></>
      : kind === "previous" ? <path d="M12 19V5m-5 5 5-5 5 5" /> : <path d="M12 5v14m-5-5 5 5 5-5" />}
  </svg>;
}

/** Quiet controls at rest; destination text is revealed only on request. */
export function JunctionControls() {
  const store = useContext(ThreadriftContext)!;
  const graph = useThreadrift(s => s.graph);
  const path = useThreadrift(s => s.activePath);
  const activeEdges = useThreadrift(s => s.activeEdges);
  const error = useThreadrift(s => s.graphError);
  const editor = useThreadrift(s => s.editorOpen);
  const revision = useThreadrift(s => s.graphRevision);
  const restIndex = useThreadrift(getRestingNodeIndex);
  const index = useThreadrift(s => Math.max(0, Math.min(s.activePath.length - 1, Math.floor(s.scrollCurrent))));
  const stationary = useThreadrift(s => !s.editorOpen && !s.cameraOverride && !s.cameraReturn && !s.inputSession && !s.isScrolling && s.scrollCurrent === s.scrollTarget);
  const previousAvailable = useThreadrift(s => s.scrollCurrent > 0);
  const nextAvailable = useThreadrift(s => s.scrollCurrent < s.activePath.length - 1);
  const current = path[index];
  const exits = graph.edges.filter(edge => edge.from === current?.id);
  const chosen = activeEdges[index];
  const fork = exits.length > 1 && restIndex !== null;
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const container = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const press = useRef<{ revision: number; eligible: boolean; pointer: number; x: number; y: number; target: EventTarget } | null>(null);

  useEffect(() => { setOpen(false); }, [stationary, current?.id, revision]);
  useEffect(() => {
    const clear = () => { press.current = null; };
    const move = (event: PointerEvent) => {
      const start = press.current;
      if (start?.pointer === event.pointerId && Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 8) clear();
    };
    const down = (event: PointerEvent) => {
      if (press.current && press.current.pointer !== event.pointerId) clear();
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const hiddenPage = () => { if (document.hidden) { clear(); setOpen(false); } };
    const unsubscribe = store.subscribe((state, previous) => {
      if (state.graphRevision !== previous.graphRevision || state.editorOpen || state.inputSession || state.isScrolling || state.scrollCurrent !== state.scrollTarget) clear();
    });
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointercancel", clear, true);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", hiddenPage);
    return () => {
      unsubscribe();
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointercancel", clear, true);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", hiddenPage);
    };
  }, [store]);

  const pointerStart = (event: React.PointerEvent, requireNode: boolean) => {
    if (!event.isPrimary || event.button !== 0 || event.ctrlKey || event.metaKey) { press.current = null; return; }
    const state = store.getState();
    press.current = { revision: state.graphRevision, pointer: event.pointerId, x: event.clientX, y: event.clientY, target: event.currentTarget,
      eligible: requireNode ? getRestingNodeIndex(state) !== null :
        !state.editorOpen && !state.cameraOverride && !state.cameraReturn && !state.inputSession && !state.isScrolling && state.scrollCurrent === state.scrollTarget };
  };
  const activate = (event: React.MouseEvent, action: () => void) => {
    const pending = press.current;
    press.current = null;
    if (event.detail !== 0 && (!pending?.eligible || pending.target !== event.currentTarget || pending.revision !== store.getState().graphRevision ||
      Math.hypot(event.clientX - pending.x, event.clientY - pending.y) >= 8)) return;
    action();
  };
  const step = (direction: -1 | 1) => {
    setOpen(false);
    store.getState().navigationElement?.focus({ preventScroll: true });
    store.getState().stepNavigation(direction);
  };
  const status = !current ? "Loading map" : !stationary ? "Travelling" : !nextAvailable ? `End of route: ${current.name}` :
    restIndex === null ? "Between nodes" : `At ${current.name}. Continue to ${graph.nodes[chosen?.to]?.name ?? "next node"}.`;
  const visible = stationary && !!current && !editor;

  return <aside ref={container} className="threadrift-route-controls" data-threadrift-controls="" aria-label="Route navigation"
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false); }}
    onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); setOpen(false); toggle.current?.focus(); } }}>
    <style>{`
      .threadrift-route-controls{position:absolute;z-index:20;left:50%;bottom:max(20px,env(safe-area-inset-bottom));transform:translateX(-50%);font:inherit;color:oklch(.91 .005 260);pointer-events:auto;touch-action:auto}
      .threadrift-route-tools{display:flex;gap:4px;align-items:center}
      .threadrift-route-controls button{font:inherit;color:inherit;cursor:pointer;border:1px solid oklch(.36 .008 260);background:oklch(.18 .008 260);border-radius:50%;min-width:44px;min-height:44px;display:inline-flex;align-items:center;justify-content:center;padding:0;transition:background-color 120ms,color 120ms}
      .threadrift-route-controls button:hover:not(:disabled){background:oklch(.28 .012 260)}
      .threadrift-route-controls button:focus-visible{outline:2px solid oklch(.8 .11 230);outline-offset:3px}
      .threadrift-route-controls button:disabled{opacity:.3;cursor:default}
      .threadrift-route-controls button[aria-expanded=true]{color:oklch(.8 .11 230)}
      .threadrift-route-options{position:absolute;bottom:54px;left:50%;transform:translateX(-50%);width:min(272px,calc(100vw - 32px));max-height:min(220px,34vh);overflow-y:auto;overscroll-behavior:contain;background:oklch(.18 .008 260);border:1px solid oklch(.36 .008 260);border-radius:12px;padding:4px;box-sizing:border-box}
      .threadrift-route-options button{border:0;background:transparent;border-radius:8px;width:100%;gap:10px;justify-content:space-between;padding:10px 12px;text-align:left;font-size:12px;line-height:1.4;overflow-wrap:anywhere}
      .threadrift-route-options button[aria-pressed=true]{color:oklch(.8 .11 230);background:oklch(.25 .025 240)}
      .threadrift-route-error{max-width:min(320px,calc(100vw - 32px));padding:10px 14px;background:oklch(.22 .025 20);border-radius:8px;font-size:12px}
      @media(max-width:600px){.threadrift-route-controls{bottom:max(24px,env(safe-area-inset-bottom))}}
      @media(prefers-reduced-motion:reduce){.threadrift-route-controls button{transition:none}}
    `}</style>
    <span role="status" aria-live="polite" style={hidden}>{status}</span>
    {error && <p role="alert" className="threadrift-route-error">{error}</p>}
    {visible && <div className="threadrift-route-tools">
      <button type="button" aria-label="Previous node" title="Previous node" disabled={!previousAvailable}
        onPointerDown={event => pointerStart(event, false)} onClick={event => activate(event, () => step(-1))}><Icon kind="previous" /></button>
      {fork && <button ref={toggle} type="button" aria-label="Change route" title={`Continue to ${graph.nodes[chosen?.to]?.name}. Change route`}
        aria-expanded={open} aria-controls={panelId} onPointerDown={event => pointerStart(event, true)}
        onClick={event => activate(event, () => setOpen(value => !value))}><Icon kind="routes" /></button>}
      <button type="button" aria-label="Next node" title="Next node" disabled={!nextAvailable}
        onPointerDown={event => pointerStart(event, false)} onClick={event => activate(event, () => step(1))}><Icon kind="next" /></button>
    </div>}
    {visible && fork && open && <div id={panelId} className="threadrift-route-options" role="group" aria-label={`Routes from ${current.name}`}>
      {exits.map((edge, i) => {
        const parallel = exits.some(other => other.id !== edge.id && other.to === edge.to);
        const label = `${graph.nodes[edge.to]?.name ?? "Unknown destination"}${parallel ? ` · Route ${i + 1}` : ""}`;
        return <button key={edge.id} type="button" aria-label={label} aria-pressed={chosen?.id === edge.id}
          onPointerDown={event => pointerStart(event, true)} onClick={event => activate(event, () => {
            store.getState().focusEdge(edge.id); setOpen(false); toggle.current?.focus();
          })}><span>{label}</span><span aria-hidden="true">{chosen?.id === edge.id ? "✓" : "↗"}</span></button>;
      })}
    </div>}
  </aside>;
}
