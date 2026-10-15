import type { SimConfig } from './config';
import { clamp01, TAU } from './math/scalar';
import type { RotationState } from './rider';

/**
 * The body in the rotation (animation spec section 11): a tucked rider
 * turns faster than an open one. Angular momentum L is fixed for a turn and
 * the rate is L / I(tuck), with I between the open and tucked moments of
 * inertia. L is chosen so a whole flip takes as long as at the old constant
 * input rate, so the controls keep their timing; only the speed profile
 * inside the turn changes (slow throw, fast tuck, slower open-and-spot).
 * Spins are normalised to the tucked rate: opening up to spot slows them.
 * Twin: BodyPhysics.luau.
 */

/** Piecewise-linear lookup in [x, y] keys sorted by x, clamped at the ends. */
export function piecewise(keys: number[][], x: number): number {
  const n = keys.length;
  if (x <= keys[0]![0]!) return keys[0]![1]!;
  for (let i = 1; i < n; i++) {
    const k1 = keys[i]!;
    if (x <= k1[0]!) {
      const k0 = keys[i - 1]!;
      const t = (x - k0[0]!) / (k1[0]! - k0[0]!);
      return k0[1]! + (k1[1]! - k0[1]!) * t;
    }
  }
  return keys[n - 1]![1]!;
}

/** I_open / I(tuck): how much faster than open the body turns. */
export const inertiaGain = (open: number, tucked: number, tuck: number): number => open / (open + (tucked - open) * tuck);

/** Tuck (0..1) at progress p (0..1) through a flip. */
export const flipTuckAt = (cfg: SimConfig, p: number): number => piecewise(cfg.physics.flipTuck, p);

/** Flip rate multiplier at this flip angle. */
export function flipRateScale(cfg: SimConfig, flipAngle: number): number {
  const ph = cfg.physics;
  if (!ph.tuckRotation) return 1;
  const turns = Math.abs(flipAngle) / TAU;
  const p = turns - Math.floor(turns);
  // K = integral over the turn of I(p) / I_open (midpoint rule), so a whole turn takes the old time.
  let k = 0;
  const n = 64;
  for (let i = 0; i < n; i++) k += 1 / inertiaGain(ph.flipInertiaOpen, ph.flipInertiaTucked, flipTuckAt(cfg, (i + 0.5) / n));
  k = k / n;
  return inertiaGain(ph.flipInertiaOpen, ph.flipInertiaTucked, flipTuckAt(cfg, p)) * k;
}

/** Spin tuck: in over `spinTuckIn`, opened over the last `spinOpen` of a carried spin. */
export function spinTuck(cfg: SimConfig, rot: RotationState): number {
  const ph = cfg.physics;
  let t = clamp01(rot.spinTime / ph.spinTuckIn);
  if (rot.spinTarget !== null) t = t * clamp01(Math.abs(rot.spinTarget - rot.spinAngle) / ph.spinOpen);
  return t;
}

/** Spin rate multiplier (1 when fully tucked). */
export function spinRateScale(cfg: SimConfig, rot: RotationState): number {
  const ph = cfg.physics;
  if (!ph.tuckRotation) return 1;
  return inertiaGain(ph.spinInertiaOpen, ph.spinInertiaTucked, spinTuck(cfg, rot)) / inertiaGain(ph.spinInertiaOpen, ph.spinInertiaTucked, 1);
}

/** Pre-wind: the spin the rider wound up for before the pop (A/D in the last `preWindWindow`) is faster. */
export function preWindScale(cfg: SimConfig, preWind: number, spinDir: number): number {
  return cfg.physics.preWind && preWind !== 0 && spinDir === preWind ? 1 + cfg.physics.preWindBonus : 1;
}

/** Speed kept after a landing: impact costs a little, a sketchy landing more. */
export function landingSpeedKeep(cfg: SimConfig, impact: number, clean: boolean): number {
  const ph = cfg.physics;
  if (!ph.landingSpeedCost) return 1;
  const cost = ph.landingCostPerMS * impact * (clean ? 1 : ph.sketchyCost);
  return 1 - Math.min(0.5, cost);
}
