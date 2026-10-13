import type { HydroConfig } from './config';
import { type Vec3, add, dot, forwardOf, horizontal, horizontalLength, rightOf, scale } from './math/vec';

export interface HydroResult {
  /** Horizontal water force on the board. */
  force: Vec3;
  /** Magnitude of the sideways force the edge is holding (N). */
  edgeLoad: number;
  /** Velocity component along the board heading (m/s). */
  vLong: number;
  /** Velocity component to the right of the heading (m/s). */
  vLat: number;
}

/**
 * Planing board on flat water. Drag acts along the board; the edge resists
 * sideways slip with a grip that grows with edge angle. That sideways force
 * is the edge load: high when the rider leans hard against a tight rope.
 * `edgeNorm` is |edgeAngle| / maxEdgeAngle in [0, 1].
 */
export function computeHydroForces(vel: Vec3, heading: number, edgeNorm: number, cfg: HydroConfig): HydroResult {
  const f = forwardOf(heading);
  const r = rightOf(heading);
  const vh = horizontal(vel);
  const vLong = dot(vh, f);
  const vLat = dot(vh, r);
  const speed = horizontalLength(vh);
  const grip = cfg.lateralGrip * (cfg.flatGripFraction + (1 - cfg.flatGripFraction) * edgeNorm);
  const latForce = -grip * vLat * Math.max(speed, cfg.gripMinSpeed);
  const longForce = -cfg.dragCoef * vLong * Math.abs(vLong);
  const linear = scale(vh, -cfg.linearDrag);
  const force = add(add(scale(f, longForce), scale(r, latForce)), linear);
  return { force, edgeLoad: Math.abs(latForce), vLong, vLat };
}
