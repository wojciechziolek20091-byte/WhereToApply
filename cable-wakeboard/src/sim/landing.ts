import type { SimConfig } from './config';
import { clamp01, TAU, wrapHalfTurn } from './math/scalar';
import { type Vec3, dot } from './math/vec';
import type { AirState, CrashReason, RiderState } from './rider';

export interface LandingResult {
  crash: CrashReason | null;
  /** Impact speed along the surface normal (m/s). */
  impact: number;
  /** 0..1, used by execution scoring. */
  quality: number;
  /** Both errors under `landing.cleanThreshold`: worth a bonus. */
  clean: boolean;
  /** Board heading off forward or switch (rad, mod PI). */
  yawError: number;
  /** Flip or roll residual from a whole turn (rad). */
  flipError: number;
  /** Whole half-turns of spin in this air, signed. */
  halfTurns: number;
  /** Whole flip or roll turns. */
  flips: number;
  /** Landed with the handle behind the back. */
  toBlind: boolean;
}

/** Spin in this air (rad), from where the board started (feature exits start sideways). */
export const airSpin = (air: AirState): number => air.rot.spinAngle - air.spinStart;

/** Flip or roll angle that has to be a whole number of turns at touchdown (rad). */
export function invertAngle(air: AirState): number {
  if (air.trick && air.trick.rollRate > 0) return air.trick.rollAngle;
  return air.rot.flipAngle;
}

/**
 * Judge a touchdown on a surface with unit normal `normal` (straight up for
 * water). In order: handle, flip/roll, yaw, grab held, raley not swung down,
 * impact (spec section 7.3).
 */
export function evaluateLanding(r: RiderState, air: AirState, normal: Vec3, cfg: SimConfig): LandingResult {
  const lc = cfg.landing;
  const spin = air.rot.spinAngle;
  const yawError = wrapHalfTurn(spin);
  const halfTurns = Math.round(airSpin(air) / Math.PI);
  const inv = invertAngle(air);
  const rolling = !!air.trick && air.trick.rollRate > 0;
  const flips = rolling ? Math.max(1, Math.round(inv / TAU)) : Math.round(Math.abs(inv) / TAU);
  const flipError = rolling ? inv - flips * TAU : Math.abs(inv) - flips * TAU;
  const impact = Math.max(0, -dot(r.vel, normal));
  const capacity = lc.stiffImpact + lc.absorbImpact * r.legCompression * (1 - r.waistHinge);
  const extension = air.trick ? air.trick.extension : 0;

  let crash: CrashReason | null = null;
  if (r.handle === 'dropped') crash = 'handleDropped';
  else if (Math.abs(flipError) > lc.maxFlipError) crash = flipError < 0 ? 'underRotated' : 'overRotated';
  else if (Math.abs(yawError) > lc.maxYawError) {
    if (air.rot.spinSide === null && air.spinStart === 0) crash = 'badLandingYaw';
    else {
      // Short of the nearest half turn in the spin direction is under-rotation; so is a
      // spin that started but stopped nearer straight than the first half turn.
      const dir = air.rot.spinDir !== 0 ? air.rot.spinDir : Math.sign(spin);
      const k = Math.round(airSpin(air) / Math.PI);
      crash = Math.sign(yawError) === -dir || (k === 0 && air.rot.spinSide !== null) ? 'underRotated' : 'overRotated';
    }
  } else if (air.grab && lc.grabHeldCrashes) crash = 'grabHeldOnLanding';
  else if (extension > cfg.waterTrick.maxLandingExtension) crash = 'raleyExtendedOnLanding';
  else if (impact > capacity) crash = 'hardLanding';

  const worst = Math.max(Math.abs(yawError), Math.abs(flipError));
  const clean = !crash && worst < lc.cleanThreshold;
  const quality = crash
    ? 0
    : clamp01(1 - 0.4 * (Math.abs(yawError) / lc.maxYawError) - 0.3 * (Math.abs(flipError) / lc.maxFlipError) - 0.3 * clamp01(impact / capacity));
  return { crash, impact, quality, clean, yawError, flipError, halfTurns, flips, toBlind: r.handle === 'behind' };
}
