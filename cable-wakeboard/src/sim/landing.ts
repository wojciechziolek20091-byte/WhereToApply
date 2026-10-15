import type { SimConfig } from './config';
import { edgeNorm } from './edge';
import { clamp01, TAU, wrapHalfTurn } from './math/scalar';
import { type Vec3, dot, headingOf, horizontalLength } from './math/vec';
import type { AirState, FallKind, RiderState } from './rider';

export interface LandingResult {
  fall: FallKind | null;
  /** Impact speed along the surface normal (m/s). */
  impact: number;
  /** 0..1, used by execution scoring. */
  quality: number;
  /** Board yaw error from the direction of travel, mod PI (rad). */
  yawError: number;
  /** Invert error from a whole number of turns (rad). */
  flipError: number;
  /** Whole half-turns of spin, signed. */
  halfTurns: number;
  /** Whole invert turns. */
  flips: number;
}

/**
 * Board yaw at touchdown. Without a spin the board follows the direction of
 * travel (the rope steers the rider in the air too), so only the spin counts.
 */
export const boardYaw = (travelHeading: number, air: AirState): number => travelHeading + air.spinAngle;

/**
 * Judge a touchdown on a surface with unit normal `normal` (straight up for
 * water). Checks in order: handle, invert, spin, edge, impact.
 */
export function evaluateLanding(r: RiderState, air: AirState, normal: Vec3, cfg: SimConfig): LandingResult {
  const lc = cfg.landing;
  const travel = horizontalLength(r.vel) > 0.5 ? headingOf(r.vel) : air.takeoffHeading;
  const yawError = wrapHalfTurn(boardYaw(travel, air) - travel);
  const halfTurns = Math.round(air.spinAngle / Math.PI);
  const flips = air.flipDir === 0 ? 0 : Math.max(1, Math.round(air.flipAngle / TAU));
  const flipError = air.flipDir === 0 ? 0 : air.flipAngle - flips * TAU;
  const impact = Math.max(0, -dot(r.vel, normal));
  const capacity = lc.stiffImpact + lc.absorbImpact * r.legCompression * (1 - r.waistHinge);

  let fall: FallKind | null = null;
  if (!r.hasHandle) fall = 'droppedHandle';
  else if (Math.abs(flipError) > lc.maxFlipError) fall = flipError < 0 ? 'underRotation' : 'overRotation';
  else if (Math.abs(yawError) > lc.maxYawError) {
    if (!air.spinStarted) fall = 'caughtEdge';
    else {
      // Short of the nearest half turn in the spin direction is under-rotation.
      const short = Math.sign(yawError) !== Math.sign(air.spinAngle);
      fall = short ? 'underRotation' : 'overRotation';
    }
  } else if (edgeNorm(r, cfg.edge) > lc.maxEdgeFraction) fall = 'caughtEdge';
  else if (air.raleyExtension > 0.3 || impact > capacity) fall = 'buttCheck';

  const quality = fall
    ? 0
    : clamp01(
        1 -
          0.35 * (Math.abs(yawError) / lc.maxYawError) -
          0.3 * (Math.abs(flipError) / lc.maxFlipError) -
          0.35 * clamp01(impact / capacity) * clamp01(impact / capacity),
      );
  return { fall, impact, quality, yawError, flipError, halfTurns, flips };
}
