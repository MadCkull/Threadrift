import {
  createRouteGeometry, getActiveRoute, progressToDistance, distanceToProgress,
} from "@threadrift/core";
import type { ThreadriftStore } from "./threadrift-store";

export type InputSource = "wheel" | "pointer" | "keyboard";
export interface InputSession { id: number; source: InputSource; blocked: boolean }

export function routeState(state: ThreadriftStore, branchChoices = state.branchChoices) {
  const route = getActiveRoute(state.graph, branchChoices);
  const routeGeometry = createRouteGeometry(state.graph, state.sequences, route);
  return {
    branchChoices, activePath: route.nodes, activeEdges: route.edges, routeGeometry,
    distanceCurrent: progressToDistance(routeGeometry, state.scrollCurrent),
    distanceTarget: progressToDistance(routeGeometry, state.scrollTarget),
  };
}

/** Forward travel follows the preselected route; retreat pauses at earlier forks. */
export function constrainTravel(state: ThreadriftStore, requestedDistance: number) {
  const geometry = state.routeGeometry;
  if (!geometry || !Number.isFinite(requestedDistance)) return state.distanceTarget;
  const origin = state.distanceTarget;
  let target = Math.max(0, Math.min(geometry.totalLength, requestedDistance));
  if (target < origin) {
    for (let i = geometry.nodeDistances.length - 1; i >= 0; i--) {
      const boundary = geometry.nodeDistances[i];
      if (boundary < origin && boundary >= target &&
        state.graph.edges.filter((edge) => edge.from === state.activePath[i].id).length > 1) {
        target = boundary;
        break;
      }
    }
  }
  return target;
}

export function targetPatch(state: ThreadriftStore, requestedDistance: number) {
  if (!state.routeGeometry) return {};
  const distanceTarget = constrainTravel(state, requestedDistance);
  return { distanceTarget, scrollTarget: distanceToProgress(state.routeGeometry, distanceTarget),
    travelDirection: Math.sign(distanceTarget - state.distanceCurrent) as -1 | 0 | 1 };
}

export function advanceMotion(state: ThreadriftStore, dtMs: number, reducedMotion: boolean): Partial<ThreadriftStore> | null {
  const geometry = state.routeGeometry;
  if (!geometry || state.nodeDragActive || !Number.isFinite(dtMs) || dtMs <= 0) return null;
  let distanceTarget = state.distanceTarget;
  // Finish a nearby idle stop at an exact endpoint. Mid-edge rest remains ineligible.
  if (!state.inputSession && !state.isScrolling) {
    const nearest = Math.round(state.scrollTarget);
    if (state.physics.snapStrength > 0 && state.travelDirection !== 0 &&
      Math.sign(nearest - state.scrollTarget) === state.travelDirection &&
      Math.abs(state.scrollTarget - nearest) < state.physics.snapThreshold) {
      distanceTarget = constrainTravel(state, geometry.nodeDistances[nearest] ?? distanceTarget);
    }
  }
  const diff = distanceTarget - state.distanceCurrent;
  const normalTau = 100 * 0.18 / Math.max(0.01, state.physics.snapStrength);
  const tau = state.inputSession?.blocked && state.travelDirection < 0 ? Math.min(45, normalTau) : normalTau;
  const alpha = 1 - Math.exp(-Math.min(dtMs, 64) / tau);
  const distanceCurrent = reducedMotion || Math.abs(diff) < 0.05
    ? distanceTarget : state.distanceCurrent + diff * alpha;
  const scrollCurrent = distanceToProgress(geometry, distanceCurrent);
  const scrollTarget = distanceToProgress(geometry, distanceTarget);
  if (distanceCurrent === state.distanceCurrent && distanceTarget === state.distanceTarget) return null;
  const travelledEdges = state.activeEdges.slice(0, Math.ceil(scrollCurrent)).map((edge) => edge.id);
  const visitedNodes = new Set(state.visitedNodes);
  const low = Math.ceil(Math.min(state.scrollCurrent, scrollCurrent));
  const high = Math.floor(Math.max(state.scrollCurrent, scrollCurrent));
  for (let i = low; i <= high; i++) if (state.activePath[i]) visitedNodes.add(state.activePath[i].id);
  return { distanceCurrent, distanceTarget, scrollCurrent, scrollTarget, travelledEdges,
    visitedNodes: visitedNodes.size === state.visitedNodes.size ? state.visitedNodes : visitedNodes };
}
