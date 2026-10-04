/** Native input policy. These helpers never select a route. */
export const WHEEL_QUIET_MS = 90;
export const REVERSE_PAUSE_MS = 90;
export const REVERSE_RESTART_GAP_MS = 40;
export const DRAG_THRESHOLD_PX = 8;

/** Descendant capture loss bubbles when implicit touch capture transfers to the viewer. */
export function shouldCancelPointerCapture(
  activePointerId: number | undefined,
  eventPointerId: number,
  eventTargetIsOwner: boolean,
  ownerHasCapture: boolean,
): boolean {
  return activePointerId === eventPointerId && eventTargetIsOwner && !ownerHasCapture;
}

/** A pause has one deadline; arriving momentum samples cannot push it back. */
export class WheelReversePause {
  private deadline: number | null = null;
  constructor(readonly durationMs = REVERSE_PAUSE_MS) {}
  start(now: number) { if (this.deadline === null) this.deadline = now + this.durationMs; }
  ready(now: number) { return this.deadline !== null && now >= this.deadline; }
  reset() { this.deadline = null; }
}

/** Only a blocked reverse stop uses this narrow fresh-intent shortcut. */
export function isFreshReverseWheelIntent(
  gapMs: number,
  momentum: boolean | undefined,
  previousMomentum: boolean | undefined,
): boolean {
  if (momentum === true) return false;
  return (Number.isFinite(gapMs) && gapMs >= REVERSE_RESTART_GAP_MS) ||
    (momentum === false && previousMomentum === true);
}

export function clampInputDelta(value: number, limit = 1200): number {
  return Number.isFinite(value) ? Math.max(-limit, Math.min(limit, value)) : 0;
}

export function normalizeWheelDelta(
  event: Pick<WheelEvent, "deltaX" | "deltaY" | "deltaMode">,
  lineHeight = 16,
  pageHeight = 800,
): { x: number; y: number } {
  const unit = event.deltaMode === 1 ? lineHeight : event.deltaMode === 2 ? pageHeight : 1;
  return { x: clampInputDelta(event.deltaX * unit), y: clampInputDelta(event.deltaY * unit) };
}

/** Ownership is latched for the full sequence, including a nested scroller's tail. */
export class WheelSessionTracker {
  private lastTime = -Infinity;
  private owned = false;
  constructor(readonly quietMs = WHEEL_QUIET_MS) {}

  sample(now: number, eligible: boolean, nativeMomentum?: boolean) {
    const fresh = now - this.lastTime >= this.quietMs;
    if (fresh) this.owned = eligible && nativeMomentum !== true;
    this.lastTime = now;
    return { fresh, owned: this.owned };
  }

  reset() { this.lastTime = -Infinity; this.owned = false; }
}

const CONTENT_SELECTOR = '[data-threadrift-content], [data-threadrift-controls], [data-threadrift-ignore], input, textarea, select, button, a, [contenteditable="true"], [role="textbox"]';

export function isNavigationSurface(target: EventTarget | null, viewer: HTMLElement): boolean {
  if (!(target instanceof Element) || !viewer.contains(target)) return false;
  if (target.closest(CONTENT_SELECTOR)) return false;
  const surface = target.closest('[data-threadrift-surface]');
  return !!surface && viewer.contains(surface);
}

export interface InputTraceSample {
  time: number;
  type: string;
  deltaX?: number;
  deltaY?: number;
  deltaMode?: number;
  momentum?: boolean;
  pointerId?: number;
  pointerType?: string;
  x?: number;
  y?: number;
  ctrl?: boolean;
  meta?: boolean;
  cancelable: boolean;
  prevented: boolean;
}

/** Opt-in, bounded, in-memory recorder: no DOM text, identifiers, persistence, or network. */
export function createInputRecorder(element: HTMLElement, maxSamples = 10000) {
  const samples: InputTraceSample[] = [];
  const start = performance.now();
  const limit = Number.isFinite(maxSamples) ? Math.max(1, Math.floor(maxSamples)) : 10000;
  const record = (event: Event) => {
    const sample: InputTraceSample = {
      time: performance.now() - start, type: event.type,
      cancelable: event.cancelable, prevented: event.defaultPrevented,
    };
    if (event instanceof WheelEvent) {
      Object.assign(sample, { deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode,
        ctrl: event.ctrlKey, meta: event.metaKey });
      const momentum = (event as WheelEvent & { momentum?: boolean }).momentum;
      if (typeof momentum === 'boolean') sample.momentum = momentum;
    } else if (event instanceof PointerEvent) {
      Object.assign(sample, { pointerId: event.pointerId, pointerType: event.pointerType,
        x: event.clientX, y: event.clientY, ctrl: event.ctrlKey, meta: event.metaKey });
    }
    if (samples.length === limit) samples.shift();
    samples.push(sample);
    // Observe the final cancellation result regardless of listener registration order.
    queueMicrotask(() => { sample.prevented = event.defaultPrevented; });
  };
  const types = ['wheel', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture'];
  types.forEach(type => element.addEventListener(type, record, { passive: true }));
  return {
    snapshot: () => samples.map(sample => ({ ...sample })),
    clear: () => { samples.length = 0; },
    stop: () => types.forEach(type => element.removeEventListener(type, record)),
    toJSON: () => JSON.stringify({ version: 1, samples }, null, 2),
  };
}
