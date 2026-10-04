import { mixPoint, sampleCamera, smoothstep } from "@threadrift/core";
import type { ThreadriftStore } from "./threadrift-store";

export const CAMERA_RETURN_MS = 180;
export function cameraNavigationBlocked(state: ThreadriftStore) {
  return state.cameraOverride !== null || state.cameraReturn !== null;
}
export function resolveCamera(state: ThreadriftStore) {
  if (state.cameraOverride) return state.cameraOverride;
  const destination = sampleCamera(state.routeGeometry, state.scrollCurrent);
  return state.cameraReturn ? mixPoint(state.cameraReturn.from, destination,
    smoothstep(Math.min(1, state.cameraReturn.elapsed / CAMERA_RETURN_MS))) : destination;
}
