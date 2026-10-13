import type { RopeConfig } from './config';
import { type Vec3, dot, length, scale, sub, vec3 } from './math/vec';

export interface RopeResult {
  /** Tension in newtons, never negative. */
  tension: number;
  /** Unit vector from the rider's hips toward the carrier. */
  dir: Vec3;
  /** Force the rope puts on the rider. */
  force: Vec3;
  /** Distance beyond the effective length (negative when slack). */
  stretch: number;
  /** Rate the distance is growing (m/s). */
  stretchRate: number;
}

/**
 * One-sided spring-damper between carrier and hips. The rope only pulls.
 * `effectiveLength` is rope length plus handle-to-hips distance, so arms
 * drifting out give slack (see posture.ts).
 */
export function computeRopeTension(
  carrierPos: Vec3,
  carrierVel: Vec3,
  hipPos: Vec3,
  hipVel: Vec3,
  effectiveLength: number,
  cfg: RopeConfig,
): RopeResult {
  const toCarrier = sub(carrierPos, hipPos);
  const dist = length(toCarrier);
  const dir = dist > 1e-9 ? scale(toCarrier, 1 / dist) : vec3(0, 1, 0);
  // d(dist)/dt: hips moving away from the carrier along the rope.
  const stretchRate = -dot(sub(hipVel, carrierVel), dir);
  const stretch = dist - effectiveLength;
  if (stretch <= 0) {
    return { tension: 0, dir, force: vec3(), stretch, stretchRate };
  }
  const tension = Math.max(0, cfg.stiffness * stretch + cfg.damping * stretchRate);
  return { tension, dir, force: scale(dir, tension), stretch, stretchRate };
}
