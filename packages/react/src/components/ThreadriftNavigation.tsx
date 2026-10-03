"use client";

import { useEffect, useRef, useContext } from "react";
import Lenis from "lenis";
import { useThreadrift, ThreadriftContext } from "../context/ThreadriftContext";
import { getRestingNodeIndex } from "../store/navigation";
import { 
  SCROLL_IDLE_TIMEOUT,
  SNAP_DEAD_ZONE,
} from "@threadrift/core";
import { 
  detectBranchIntent, 
  applyMagneticSnap 
} from "@threadrift/core";

export function ThreadriftNavigation() {
  const lenisRef = useRef<Lenis | null>(null);
  const snapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const storeApi = useContext(ThreadriftContext);

  // Zustand bindings
  const setScrollTarget = useThreadrift((s) => s.setScrollTarget);
  const setScrollCurrent = useThreadrift((s) => s.setScrollCurrent);
  const setIsScrolling = useThreadrift((s) => s.setIsScrolling);
  const setBranchChoice = useThreadrift((s) => s.setBranchChoice);

  // Initialize Lenis
  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.2,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), // expoOut
      orientation: "vertical",
      gestureOrientation: "both", // allow x and y
      wheelMultiplier: 1,
    });
    lenisRef.current = lenis;

    // Use requestAnimationFrame for Lenis loop
    let rafId: number;
    function raf(time: number) {
      lenis.raf(time);
      rafId = requestAnimationFrame(raf);
    }
    requestAnimationFrame(raf);

    return () => {
      lenis.destroy();
      cancelAnimationFrame(rafId);
    };
  }, []);

  // Handle Wheel + Touch Events (Custom Physics)
  useEffect(() => {
    function processGesture(dx: number, dy: number, sensitivity: number, preventDefault: () => void) {
      if (!storeApi) return;
      const state = storeApi.getState();
      const { graph, activePath, branchChoices } = state;
      if (!graph.nodes || activePath.length === 0) return;

      preventDefault();

      const currentScrollTarget = state.scrollTarget;

      // Snap dead zone: if snapped to a node, ignore small movements
      const isSnapped = Math.abs(currentScrollTarget - Math.round(currentScrollTarget)) < 0.01;
      const gestureMag = Math.hypot(dx, dy);
      if (isSnapped && gestureMag < SNAP_DEAD_ZONE) {
        return; // Ignore tiny accidental movements when snapped
      }

      // Branch Detection & Path Locking
      const restingIndex = getRestingNodeIndex(state);
      if (snapTimeoutRef.current) clearTimeout(snapTimeoutRef.current);

      // Determine base movement
      const currentNode = restingIndex === null ? undefined : activePath[restingIndex];

      // Default to vertical scrolling driving forward/backward progress
      let movement = dy * sensitivity;

      if (currentNode) {
        const { edgeId, type } = detectBranchIntent(
          dx,
          dy,
          currentNode,
          graph,
          branchChoices[currentNode.id]
        );

        if (edgeId) {
          if (type === "branch") {
            setBranchChoice(currentNode.id, edgeId);
          } else if (type === "main") {
            setBranchChoice(currentNode.id, null);
          }
          
          // If the user made a strong horizontal swipe to select a branch, 
          // translate that into forward movement so they don't have to scroll down immediately after.
          if (Math.abs(dx) > Math.abs(dy)) {
            movement = Math.abs(dx) * sensitivity;
          }
        }
      }

      // If they swipe left/right while strictly at a node but it doesn't match a branch
      // (or there's only 1 branch), we still want them to be able to move forward smoothly.
      if (Math.abs(movement) < 0.001 && Math.abs(dx) > 0) {
          movement = dx * sensitivity;
      }

      // Update scroll target
      // A branch choice can change path length synchronously on this gesture.
      const maxScroll = storeApi.getState().activePath.length - 1;
      let newTarget = currentScrollTarget + movement;
      newTarget = Math.max(0, Math.min(newTarget, maxScroll));
      
      setIsScrolling(true);
      setScrollTarget(newTarget);

      // Setup magnetic snap timeout
      snapTimeoutRef.current = setTimeout(() => {
        setIsScrolling(false);
      }, SCROLL_IDLE_TIMEOUT);
    }

    // ── Wheel handler ──
    function handleWheel(e: WheelEvent) {
      const scrollSens = storeApi?.getState().physics.scrollSensitivity ?? 0.001;
      processGesture(e.deltaX, e.deltaY, scrollSens, () => e.preventDefault());
    }

    // ── Touch handlers ──
    let lastTouchX = 0;
    let lastTouchY = 0;
    
    function handleTouchStart(e: TouchEvent) {
      if (e.touches.length !== 1) return;
      lastTouchX = e.touches[0].clientX;
      lastTouchY = e.touches[0].clientY;
    }
    
    function handleTouchMove(e: TouchEvent) {
      if (e.touches.length !== 1) return;
      
      const currentX = e.touches[0].clientX;
      const currentY = e.touches[0].clientY;
      
      const dx = lastTouchX - currentX;
      const dy = lastTouchY - currentY;
      
      lastTouchX = currentX;
      lastTouchY = currentY;
      
      const touchSens = storeApi?.getState().physics.touchSensitivity ?? 0.003;
      processGesture(dx, dy, touchSens, () => e.cancelable && e.preventDefault());
    }

    function handleTouchEnd() {
      // Immediately trigger snap when finger lifts
      setIsScrolling(false);
    }

    // Attach listeners
    window.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("touchstart", handleTouchStart, { passive: false });
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleTouchEnd);
    
    return () => {
      if (snapTimeoutRef.current) clearTimeout(snapTimeoutRef.current);
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
    };
  }, [setIsScrolling, setBranchChoice, setScrollTarget, storeApi]);

  // Handle Animation Loop (Snapping and Current Interpolation)
  useEffect(() => {
    let rafId: number;

    function loop() {
      if (!storeApi) return;
      const state = storeApi.getState();
      const { snapStrength, snapThreshold } = state.physics;
      
      // Magnetic snapping (runs always — even DURING scrolling for stickiness)
      if (!state.isScrolling) {
        const snappedTarget = applyMagneticSnap(state.scrollTarget, snapThreshold, snapStrength);
        if (snappedTarget !== state.scrollTarget) {
          setScrollTarget(snappedTarget);
        }
      }

      // Smooth interpolation from current to target (faster lerp = 0.16)
      const target = storeApi.getState().scrollTarget;
      let current = storeApi.getState().scrollCurrent;
      
      const diff = target - current;
      if (Math.abs(diff) < 0.001) {
        // Hard snap to exact value to prevent micro-jitter
        if (current !== target) setScrollCurrent(target);
      } else {
        current += diff * 0.16; // 60% faster than old 0.1
        setScrollCurrent(current);
      }

      rafId = requestAnimationFrame(loop);
    }
    
    loop();
    
    return () => cancelAnimationFrame(rafId);
  }, [setScrollCurrent, setScrollTarget, storeApi]);

  return null; // This is a logic-only component
}
