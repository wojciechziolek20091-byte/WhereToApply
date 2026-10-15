import type { SimConfig } from './config';
import { exp, pow } from './math/detmath';
import { clamp01, lerp } from './math/scalar';
import type { RiderState } from './rider';

/**
 * Pops (spec sections 9.2, 9.3 and 10.2): the ollie charge, the kicker lip
 * pop, and the tension tracking that times water tricks.
 */

/** Charge from how long Space was held (0..1). */
export const ollieCharge = (heldTime: number, cfg: SimConfig): number => clamp01(heldTime / cfg.ollie.chargeTime);

/** Vertical speed of an ollie with that charge (m/s). */
export const ollieSpeed = (charge: number, cfg: SimConfig): number => lerp(cfg.ollie.minV, cfg.ollie.maxV, clamp01(charge));

/**
 * Smooth the raw tension (exponential filter, `rope.smoothTau`) and track the
 * recent peak of the smoothed value. Raw tension drives physics; the smoothed
 * one drives the HUD and the trick logic.
 */
export function updateTensionTracker(r: RiderState, cfg: SimConfig, dt: number): void {
  const alpha = 1 - exp(-dt / cfg.rope.smoothTau);
  r.tensionPrev2 = r.tensionPrev;
  r.tensionPrev = r.tensionSmooth;
  r.tensionSmooth += (r.ropeTension - r.tensionSmooth) * alpha;
  if (r.tensionSmooth >= r.tensionPeak) {
    r.tensionPeak = r.tensionSmooth;
    r.tensionPeakAge = 0;
    return;
  }
  r.tensionPeakAge += dt;
  if (r.tensionPeakAge > cfg.waterTrick.historyTime) {
    r.tensionPeak = r.tensionSmooth;
    r.tensionPeakAge = 0;
  }
}

/**
 * Pop timing against the tension peak, 0..1. After the peak: how long ago it
 * was. Still rising: how long until the peak is predicted from the first and
 * second differences of the smoothed tension.
 */
export function waterTrickTiming(r: RiderState, cfg: SimConfig, dt: number): number {
  const wt = cfg.waterTrick;
  if (r.tensionPeakAge > 0) return 1 - clamp01(r.tensionPeakAge / wt.peakWindow);
  const d1 = (r.tensionSmooth - r.tensionPrev) / dt;
  const d2 = (r.tensionSmooth - 2 * r.tensionPrev + r.tensionPrev2) / (dt * dt);
  if (d1 <= 0) return 1;
  const timeToPeak = d2 < 0 ? -d1 / d2 : wt.peakWindow;
  return 1 - clamp01(timeToPeak / wt.peakWindow);
}

/** Planned height of a water trick (m): h = base * (T / threshold)^1.2 * (0.5 + 0.5 timing), capped. */
export function waterTrickHeight(tension: number, timing: number, cfg: SimConfig): number {
  const wt = cfg.waterTrick;
  const h = wt.baseHeight * pow(Math.max(0, tension) / wt.tensionThreshold, 1.2) * (0.5 + 0.5 * clamp01(timing));
  return Math.min(wt.maxHeight, h);
}
