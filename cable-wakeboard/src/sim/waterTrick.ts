import type { SimConfig } from './config';
import { DT, GRAVITY } from './config';
import { edgeNorm } from './edge';
import type { InputFrame, InputMemory } from './input';
import { TAU, wrapAngle } from './math/scalar';
import { headingOf, horizontalLength } from './math/vec';
import { waterTrickHeight } from './pop';
import type { RiderState, WaterTrickState } from './rider';

/**
 * Tension-based water tricks (spec section 10): raley, backroll, frontroll,
 * S-bend. Armed when the rider is sideways to the rope, edging hard with the
 * handle in front and the smoothed tension over the threshold; popped with
 * Space, picked by S / W held at the pop.
 */

/** Travelling at a big enough angle to the rope. */
export function isSideways(r: RiderState, cfg: SimConfig): boolean {
  if (horizontalLength(r.vel) < 0.5) return false;
  return Math.abs(wrapAngle(headingOf(r.vel) - r.ropeHeading)) > cfg.waterTrick.sidewaysAngle;
}

/** All the arming conditions of spec section 10.1. */
export const canArm = (r: RiderState, cfg: SimConfig): boolean =>
  isSideways(r, cfg) &&
  r.tensionSmooth > cfg.waterTrick.tensionThreshold &&
  edgeNorm(r, cfg.edge) > cfg.waterTrick.minEdge &&
  r.handle === 'inFront';

/** Disarm: smoothed tension fell below threshold minus the hysteresis. */
export const shouldDisarm = (r: RiderState, cfg: SimConfig): boolean =>
  r.tensionSmooth < cfg.waterTrick.tensionThreshold - cfg.waterTrick.hysteresis;

/** Airtime of a jump to height h (m), ignoring the rope (s). */
export const airtimeFor = (h: number): number => 2 * Math.sqrt((2 * Math.max(0, h)) / GRAVITY);

/**
 * Plan the trick at the pop. Returns the vertical speed and the trick state.
 * Rolls turn at the rate that fits the airtime, but never faster than the
 * rate that fits `minRollHeight`: a lower pop cannot finish the roll.
 */
export function planWaterTrick(
  tension: number,
  timing: number,
  input: InputFrame,
  cfg: SimConfig,
): { vy: number; trick: WaterTrickState } {
  const height = waterTrickHeight(tension, timing, cfg);
  const vy = Math.sqrt(2 * GRAVITY * height);
  const airtime = airtimeFor(height);
  const kind: WaterTrickState['kind'] = input.back ? 'backroll' : input.forward ? 'frontroll' : 'raley';
  const rollTime = Math.max(airtime, airtimeFor(cfg.waterTrick.minRollHeight)) * 0.85;
  return {
    vy,
    trick: {
      kind,
      sBend: 0,
      airtime,
      u: 0,
      extension: 0,
      rollAngle: 0,
      rollRate: kind === 'raley' ? 0 : TAU / rollTime,
      timing,
      height,
      sBendKeyHeld: false,
    },
  };
}

/** Raley body extension (rad) at progress u. */
export function raleyExtension(u: number, cfg: SimConfig): number {
  const wt = cfg.waterTrick;
  if (u < wt.popPhaseEnd) return (u / wt.popPhaseEnd) * (Math.PI / 2);
  if (u < wt.extensionEnd) return Math.PI / 2;
  if (u < wt.swingDownEnd) return (Math.PI / 2) * (1 - (u - wt.extensionEnd) / (wt.swingDownEnd - wt.extensionEnd));
  return 0;
}

/** In the raley position: body horizontal, board above the head. */
export const isInRaleyPosition = (t: WaterTrickState, cfg: SimConfig): boolean =>
  t.kind === 'raley' && t.u >= cfg.waterTrick.popPhaseEnd && t.u < cfg.waterTrick.extensionEnd;

/**
 * One tick of a water trick. Spins, grabs and S-bends keep the rider
 * extended, so the swing-down runs slower while they are held. Returns the
 * spin input that is left for the rotation tracker (0 while the A/D key that
 * started an S-bend is still held).
 */
export function stepWaterTrick(t: WaterTrickState, input: InputFrame, mem: InputMemory, cfg: SimConfig): number {
  const wt = cfg.waterTrick;
  const dt = DT;
  if (t.sBendKeyHeld && mem.steerDir !== t.sBend) t.sBendKeyHeld = false;
  const pressedNow = mem.steerDir !== 0 && mem.steerHeldTime === 0;
  if (
    t.sBend === 0 &&
    pressedNow &&
    isInRaleyPosition(t, cfg) &&
    t.u >= cfg.sBend.windowStart &&
    t.u <= cfg.sBend.windowEnd
  ) {
    t.sBend = mem.steerDir;
    t.sBendKeyHeld = true;
    // The roll fits the rest of the trick.
    t.rollRate = TAU / Math.max(0.2, (1 - t.u) * t.airtime * 0.85);
  }
  const spin = t.sBendKeyHeld ? 0 : mem.steerDir;
  const held = spin !== 0 || input.grab || t.sBend !== 0;
  const swinging = t.u >= wt.extensionEnd && t.u < wt.swingDownEnd;
  const rate = swinging && held ? wt.heldSwingFactor : 1;
  t.u = Math.min(1, t.u + (dt / Math.max(t.airtime, 0.1)) * rate);
  t.extension = t.kind === 'raley' ? raleyExtension(t.u, cfg) : 0;
  if (t.rollRate > 0 && t.rollAngle < TAU) t.rollAngle = Math.min(TAU, t.rollAngle + t.rollRate * dt);
  return spin;
}
