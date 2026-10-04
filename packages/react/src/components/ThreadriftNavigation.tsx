"use client";

import { useEffect, useContext } from "react";
import { CAMERA_SCALE } from "@threadrift/core";
import { cameraNavigationBlocked } from "../store/camera-state";
import { useThreadrift, ThreadriftContext } from "../context/ThreadriftContext";
import { DRAG_THRESHOLD_PX, WHEEL_QUIET_MS, WheelSessionTracker, WheelReversePause, isFreshReverseWheelIntent, isNavigationSurface, normalizeWheelDelta, shouldCancelPointerCapture } from "../input/native-input";

/** Input adapters only emit travel commands; route choices belong to explicit controls. */
export function ThreadriftNavigation() {
  const store = useContext(ThreadriftContext);
  const element = useThreadrift(state => state.navigationElement);

  useEffect(() => {
    if (!store || !element) return;
    const wheel = new WheelSessionTracker();
    const reversePause = new WheelReversePause();
    let reversePauseSession: number | null = null;
    let previousWheelSample: { time: number; momentum?: boolean } | null = null;
    let wheelSession: number | null = null;
    let wheelDraining = false;
    let wheelTimer: ReturnType<typeof setTimeout> | undefined;
    let pointer: { id: number; x: number; y: number; lastY: number; dragging: boolean; session: number | null } | null = null;
    const pointers = new Set<number>();
    let multiTouch = false;
    let suppressClickUntil = 0;

    const worldScale = () => {
      const rect = element.getBoundingClientRect();
      return Math.max(0.01, CAMERA_SCALE * Math.max(rect.width, rect.height) / 1000);
    };
    const selectedText = () => !!window.getSelection()?.toString();
    const isOwned = (event: Event) => !event.defaultPrevented && !store.getState().nodeDragActive && !cameraNavigationBlocked(store.getState()) &&
      isNavigationSurface(event.target, element) && !selectedText();
    const cancel = () => {
      if (wheelTimer) clearTimeout(wheelTimer);
      wheelTimer = undefined;
      wheelSession = null;
      wheelDraining = false;
      reversePauseSession = null;
      reversePause.reset();
      previousWheelSample = null;
      // A cancelled sequence cannot resume with an already arriving tail.
      wheel.reset();
      wheel.sample(performance.now(), false);
      if (pointer) suppressClickUntil = performance.now() + 800;
      const captured = pointer;
      pointer = null;
      if (captured && element.hasPointerCapture(captured.id)) element.releasePointerCapture(captured.id);
      pointers.clear();
      multiTouch = false;
      store.getState().cancelInput();
    };

    const handleWheel = (event: WheelEvent) => {
      const now = performance.now();
      const momentum = (event as WheelEvent & { momentum?: boolean }).momentum;
      const previousMomentum = previousWheelSample?.momentum;
      const gap = previousWheelSample ? now - previousWheelSample.time : Infinity;
      previousWheelSample = { time: now, momentum };
      const state = store.getState();
      const rawLine = Number.parseFloat(getComputedStyle(element).lineHeight);
      const delta = normalizeWheelDelta(event, Number.isFinite(rawLine) ? rawLine : 16, element.clientHeight || 800);
      const zoom = event.ctrlKey || event.metaKey;
      // A horizontal-only sample on the map has no navigation intent yet.
      // Events owned by content or browser zoom must still latch their ownership.
      if (delta.y === 0 && !zoom && event.cancelable && isOwned(event) && !pointer) return;
      const atRest = state.scrollCurrent === state.scrollTarget && Number.isInteger(state.scrollCurrent);
      const last = state.activePath[state.activePath.length - 1];
      const outward = atRest && ((state.scrollCurrent === 0 && delta.y < 0) ||
        (state.scrollCurrent === state.activePath.length - 1 && delta.y > 0 &&
          last && !state.graph.edges.some(edge => edge.from === last.id)));
      const eligible = !zoom && event.cancelable && delta.y !== 0 && isOwned(event) && !outward && !pointer;
      const session = wheel.sample(now, eligible, momentum);
      if (session.fresh) {
        reversePauseSession = null;
        reversePause.reset();
      }
      if (session.fresh) wheelDraining = momentum === true && !zoom && event.cancelable && isOwned(event);
      if (session.fresh && wheelSession !== null) {
        state.endInput(wheelSession);
        wheelSession = null;
      }
      if (wheelTimer) clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => {
        if (wheelSession !== null) store.getState().endInput(wheelSession);
        wheelSession = null;
        wheelTimer = undefined;
      }, WHEEL_QUIET_MS);
      // Modifier zoom and events owned elsewhere are never cancelled. Stop graph motion too.
      if (zoom || !event.cancelable || !isNavigationSurface(event.target, element) || state.nodeDragActive || cameraNavigationBlocked(state)) {
        if (zoom) store.getState().cancelInput();
        else if (wheelSession !== null) store.getState().endInput(wheelSession);
        wheelSession = null;
        return;
      }
      // A browser-labelled momentum tail after a quiet gap may not start travel
      // or leak through a graph decision into document scrolling.
      if (wheelDraining && isOwned(event)) {
        event.preventDefault();
        return;
      }
      if (!session.owned || event.defaultPrevented) return;
      if (session.fresh) wheelSession = store.getState().beginInput('wheel');
      if (wheelSession === null) return;
      event.preventDefault();
      const freshReverseIntent = eligible && isFreshReverseWheelIntent(gap, momentum, previousMomentum);
      if (reversePauseSession === wheelSession && (reversePause.ready(now) || freshReverseIntent)) {
        store.getState().endInput(wheelSession);
        wheelSession = store.getState().beginInput('wheel');
        reversePauseSession = null;
        reversePause.reset();
        if (wheelSession === null) return;
      }
      store.getState().travelInput(delta.y * state.physics.scrollSensitivity * 1000 / worldScale(), wheelSession);
      const after = store.getState();
      const stoppedNode = after.activePath[after.scrollTarget];
      if (delta.y < 0 && after.inputSession?.blocked && after.scrollTarget > 0 && stoppedNode &&
        after.graph.edges.filter(edge => edge.from === stoppedNode.id).length > 1) {
        reversePauseSession = wheelSession;
        if (after.scrollCurrent === after.scrollTarget) reversePause.start(now);
      }
    };

    const handleDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') return;
      // Studio owns node/edge gestures; empty canvas still supports swipes.
      if (store.getState().editorOpen && event.target instanceof Element &&
        event.target.closest('[data-threadrift-node], [data-threadrift-edge]')) return;
      pointers.add(event.pointerId);
      if (pointers.size > 1 || !event.isPrimary) {
        multiTouch = true;
        suppressClickUntil = performance.now() + 800;
        const captured = pointer;
        pointer = null;
        if (captured && element.hasPointerCapture(captured.id)) element.releasePointerCapture(captured.id);
        store.getState().cancelInput();
        return;
      }
      if (multiTouch || event.button !== 0 || event.ctrlKey || event.metaKey || !isOwned(event)) return;
      suppressClickUntil = 0;
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, lastY: event.clientY, dragging: false, session: null };
      // Ownership/capture begins only after a drag is recognized, leaving taps alone.
    };
    const handleMove = (event: PointerEvent) => {
      if (!pointer || event.pointerId !== pointer.id || multiTouch) return;
      if (!pointer.dragging) {
        if (Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) < DRAG_THRESHOLD_PX) return;
        const state = store.getState();
        const rest = state.scrollCurrent === state.scrollTarget && Number.isInteger(state.scrollCurrent);
        const node = state.activePath[Math.round(state.scrollCurrent)];
        const outward = rest && ((state.scrollCurrent === 0 && event.clientY > pointer.y) ||
          (event.clientY < pointer.y && node && !state.graph.edges.some(edge => edge.from === node.id)));
        if (outward) {
          // Directional touch-action, set before pointerdown, lets the browser own
          // outward gestures at boundaries. Never reclaim their reversal or tail.
          pointer = null;
          suppressClickUntil = performance.now() + 800;
          return;
        }
        pointer.dragging = true;
        suppressClickUntil = Infinity;
        const previousInput = store.getState().inputSession;
        if (previousInput?.source === 'wheel' && previousInput.blocked) {
          // A newly claimed touch gesture expresses fresh intent even on a hybrid
          // device still delivering the previous wheel's blocked tail.
          store.getState().endInput(previousInput.id);
          if (wheelTimer) clearTimeout(wheelTimer);
          wheelTimer = undefined;
          wheelSession = null;
          wheelDraining = false;
          reversePauseSession = null;
          reversePause.reset();
          wheel.reset();
          wheel.sample(performance.now(), false);
        }
        pointer.session = store.getState().beginInput('pointer');
        element.setPointerCapture(event.pointerId);
      }
      const delta = pointer.lastY - event.clientY;
      pointer.lastY = event.clientY;
      if (pointer.session === null) return;
      if (event.cancelable) event.preventDefault();
      store.getState().travelInput(delta * store.getState().physics.touchSensitivity * 1000 / worldScale(), pointer.session);
    };
    const handleUp = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      if (pointer?.id === event.pointerId) {
        const session = pointer.session;
        const wasDrag = pointer.dragging;
        const captured = pointer;
        pointer = null;
        if (element.hasPointerCapture(captured.id)) element.releasePointerCapture(captured.id);
        if (session !== null) {
          if (event.type === 'pointercancel') store.getState().cancelInput();
          else store.getState().endInput(session);
        }
        if (wasDrag || event.type === 'pointercancel') suppressClickUntil = performance.now() + 800;
      }
      if (pointers.size === 0) multiTouch = false;
    };
    const handleLostCapture = (event: PointerEvent) => {
      if (!shouldCancelPointerCapture(pointer?.id, event.pointerId, event.target === element, element.hasPointerCapture(event.pointerId))) return;
      pointer = null;
      suppressClickUntil = performance.now() + 800;
      store.getState().cancelInput();
    };
    const observeAdditionalPointer = (event: PointerEvent) => {
      // Capture continues outside the viewer; a second finger there still cancels it.
      if (pointer && event.pointerId !== pointer.id && event.pointerType !== 'mouse' && !element.contains(event.target as Node)) {
        handleDown(event);
      }
    };
    const handleClick = (event: MouseEvent) => {
      if (event.detail !== 0 && performance.now() < suppressClickUntil && isNavigationSurface(event.target, element)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || store.getState().nodeDragActive || selectedText()) return;
      if (event.target !== element && !isNavigationSurface(event.target, element)) return;
      const direction = ['ArrowDown', 'PageDown'].includes(event.key) ? 1 : ['ArrowUp', 'PageUp'].includes(event.key) ? -1 : 0;
      if (!direction) return;
      event.preventDefault();
      if (event.repeat) return;
      store.getState().stepNavigation(direction as -1 | 1);
    };
    const visibility = () => { if (document.hidden) cancel(); };
    const unsubscribe = store.subscribe((next, previous) => {
      if (next.graphRevision !== previous.graphRevision || next.cameraMode !== previous.cameraMode || (next.editorOpen && !previous.editorOpen)) cancel();
      else if (reversePauseSession !== null && next.inputSession?.id === reversePauseSession &&
        next.inputSession.blocked && next.scrollCurrent === next.scrollTarget) reversePause.start(performance.now());
    });
    element.addEventListener('wheel', handleWheel, { passive: false });
    element.addEventListener('pointerdown', handleDown, true);
    element.addEventListener('pointermove', handleMove, { passive: false });
    window.addEventListener('pointerdown', observeAdditionalPointer, true);
    window.addEventListener('pointerup', handleUp, true);
    window.addEventListener('pointercancel', handleUp, true);
    element.addEventListener('lostpointercapture', handleLostCapture);
    element.addEventListener('click', handleClick, true);
    element.addEventListener('keydown', handleKey);
    window.addEventListener('blur', cancel);
    window.addEventListener('resize', cancel);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      unsubscribe();
      element.removeEventListener('wheel', handleWheel);
      element.removeEventListener('pointerdown', handleDown, true);
      element.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerdown', observeAdditionalPointer, true);
      window.removeEventListener('pointerup', handleUp, true);
      window.removeEventListener('pointercancel', handleUp, true);
      element.removeEventListener('lostpointercapture', handleLostCapture);
      element.removeEventListener('click', handleClick, true);
      element.removeEventListener('keydown', handleKey);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('resize', cancel);
      document.removeEventListener('visibilitychange', visibility);
      cancel();
    };
  }, [store, element]);

  useEffect(() => {
    if (!store) return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    let previous: number | null = null;
    let frame = 0;
    const tick = (time: number) => {
      if (!document.hidden) store.getState().advanceNavigation(previous === null ? 0 : Math.min(64, time - previous), media.matches);
      previous = document.hidden ? null : time;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [store]);

  return null;
}
