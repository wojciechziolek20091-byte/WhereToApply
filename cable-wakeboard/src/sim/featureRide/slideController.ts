import { DT } from '../config';
import type { FeatureSurface } from '../features';
import type { RidePiece } from '../featureShapes';
import type { InputFrame, InputMemory } from '../input';
import { valueNoise } from '../math/noise';
import { approach, clamp, mod, sign } from '../math/scalar';
import type { ResolvedFeature } from '../park';
import type { CrashReason, JibState } from '../rider';
import type { SimState } from '../world';

/**
 * SlideController (feature riding spec 5.1, 5.6, 5.7): what the feature does
 * to a sliding rider. Friction by material and slide, stalls, kinks (a small
 * lift over a down kink, a speed check over a sharp one), and the two-axis
 * balance meter: across the feature (rope pull across it, cross slope, noise
 * by top and slide, rope spikes; A/D taps correct it) and fore-aft in
 * boardslides and presses (rope pull along it, slope; W/S taps correct it).
 */

/** Board across the feature (90 or 270 degrees): a boardslide or lipslide. */
export const isBoardslide = (boardAngle: number): boolean => mod(Math.round(boardAngle / (Math.PI / 2)), 2) === 1;

/** Slide friction coefficient: the feature's own, else its material's; boardslides skid more. */
export function slideFriction(f: ResolvedFeature, j: JibState, s: SimState): number {
  const S = s.cfg.featureRide.Slide;
  const mu = f.shape.friction ?? S.MaterialFriction[f.shape.material] ?? s.cfg.feature.friction;
  return mu * (isBoardslide(j.boardAngle) ? S.BoardslideFriction : Math.abs(j.pressAmount) >= 0.5 ? S.PressFriction : 1);
}

/** Any input held: the knees are not soft over a kink. */
const busy = (input: InputFrame): boolean => input.steer !== 0 || input.pop || input.forward || input.back;

/**
 * Pitch along the feature this tick (`pitch`, rad). Over a down kink the
 * board lifts for a moment; landing it with anything held costs balance.
 * Kinks sharper than Slide.KinkCheckAngle check the speed: a little too fast
 * is sketchy, more throws the rider off the line.
 */
export function stepKink(s: SimState, j: JibState, pitch: number, speed: number, input: InputFrame): CrashReason | null {
  const S = s.cfg.featureRide.Slide;
  const d = j.pitch - pitch;
  j.pitch = pitch;
  if (j.lift > 0) {
    j.lift = Math.max(0, j.lift - DT);
    if (j.lift === 0 && busy(input)) j.balance += S.KinkHit * (j.balance >= 0 ? 1 : -1);
  }
  if (d < S.KinkMinAngle) return null;
  if (d > S.KinkCheckAngle) {
    const limit = (S.KinkThrowSpeed * S.KinkCheckAngle) / d;
    if (speed > limit * (1 + S.KinkSketchyMargin)) return 'kinkThrow';
    if (speed > limit) {
      j.sketchy = true;
      j.balance += S.KinkSketchyHit * (j.balance >= 0 ? 1 : -1);
    }
  }
  const lift = Math.min(S.KinkLiftPerRadSpeed * d * speed, S.KinkLiftMax);
  if (lift >= S.KinkLiftMin) j.lift = lift;
  return null;
}

/** Fore-aft limit: 1, narrowing with the time a press is held (spec 5.5), to at least Press.MinWindow. */
export function foreLimit(j: JibState, s: SimState): number {
  const P = s.cfg.featureRide.Press;
  return j.press === 0 ? 1 : Math.max(P.MinWindow, 1 - P.NarrowRate * j.pressTime);
}

/** End of the slideable part a piece belongs to, along the feature axis. */
export function partEnd(f: ResolvedFeature, part: number): number {
  let u1 = -Infinity;
  for (const q of f.shape.pieces) if (q.part === part && q.slide && q.axis === 'u' && q.u1 > u1) u1 = q.u1;
  return u1;
}

/**
 * One tick of the balance meter. `ropeLat` / `ropeAlong` are the rope force
 * across and along the feature (N). Returns 'fell' when either axis is out
 * of range, 'sketchyExit' when that happens within Balance.LastMetre of the
 * end, else null.
 */
export function stepBalance(
  s: SimState,
  j: JibState,
  f: ResolvedFeature,
  piece: RidePiece,
  surface: FeatureSurface,
  u: number,
  ropeLat: number,
  ropeAlong: number,
  mem: InputMemory,
): 'fell' | 'sketchyExit' | null {
  const { rider: r, cfg } = s;
  const B = cfg.featureRide.Balance;
  if (!cfg.feature.balanceEnabled) return null;
  // A tension spike throws the rider toward the cable side, once per spike.
  if (r.ropeTension > B.SpikeTension) {
    if (!j.spiked) j.balance += B.SpikeImpulse * sign(ropeLat);
    j.spiked = true;
  } else if (r.ropeTension < B.SpikeTension * 0.9) j.spiked = false;
  const round = piece.profile === 'Round';
  const top = round ? B.NoisePipe : piece.width >= B.BoxMinWidth ? B.NoiseBox : B.NoiseRail;
  const board = isBoardslide(j.boardAngle);
  const bySlide = round ? (board ? B.PipeBoardslideFactor : B.PipeFiftyFactor) : board ? B.BoardslideFactor : 1;
  const noise = valueNoise(j.time * B.NoiseRate, j.noiseSeed);
  j.balance += (noise * top * bySlide + ropeLat / B.RopeTip + surface.crossSlope * B.CrossSlopeGain) * DT + mem.steerTap * B.TapStrength;
  if (board || j.press !== 0) {
    const n2 = valueNoise(j.time * B.NoiseRate + 57.3, j.noiseSeed + 1);
    const lean = j.press * cfg.featureRide.Press.Lean;
    j.fore += (n2 * B.ForeNoise + ropeAlong / B.ForeRopeTip - surface.slope * B.ForeSlopeGain + lean) * DT + mem.foreTap * B.ForeTapStrength;
  } else {
    j.fore = approach(j.fore, 0, B.ForeDecay * DT);
  }
  j.fore = clamp(j.fore, -2, 2);
  if (Math.abs(j.balance) <= 1 && Math.abs(j.fore) <= foreLimit(j, s)) return null;
  return partEnd(f, piece.part) - u < B.LastMetre ? 'sketchyExit' : 'fell';
}
