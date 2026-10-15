import type { SimConfig } from './config';
import { TAU } from './math/scalar';
import type { HandleState, RotationSide, RotationState } from './rider';

/**
 * Handle system (spec section 8). While the rider rotates, the handle stays on
 * the rope, so past a certain rotation it would wrap around the body unless it
 * is passed behind the back.
 *
 * - Backside: pass zone 90-180 degrees of rotation (and every 360 after).
 *   No pass in the air: the rope stops the spin at 180, handle behind the back
 *   (spin to blind). No pass on a feature: the handle drops.
 * - Frontside: the first 180 needs no pass; pass zone 180-270 (and every 360
 *   after). DECISION: no pass in the air and the rope pulls the rider back to
 *   the 180 (the spec leaves this open); on a feature the handle drops.
 * - Q inside the window (centred on the zone, `rot.passWindow` long) passes;
 *   Q at any other time during a rotation drops the handle.
 */

export interface HandleContext {
  /** Rotation rate of this context (rad/s), to turn the window into an angle. */
  rate: number;
  /** In the air (missed backside pass goes blind) or on a feature (missed pass drops). */
  inAir: boolean;
}

export interface HandleResult {
  passed: boolean;
  dropped: boolean;
  wentBlind: boolean;
  cameOut: boolean;
}

/** Pass zone `k` (0-based) for a rotation side, in handle progress (rad). */
export function passZone(side: RotationSide, k: number): { start: number; end: number } {
  const start = (side === 'backside' ? Math.PI / 2 : Math.PI) + k * TAU;
  return { start, end: start + Math.PI / 2 };
}

/** How far the rotation has turned the body against the rope (rad), in the first spin's direction. */
export const handleProgress = (rot: RotationState): number => rot.progressOffset + rot.spinAngle * rot.startDir;

/** The open window, for the HUD ring and the pass check: centre and half-width (rad of progress). */
export function passWindowOf(rot: RotationState, ctx: HandleContext): { centre: number; half: number; zone: { start: number; end: number } } | null {
  if (rot.spinSide === null) return null;
  const zone = passZone(rot.spinSide, rot.zonesResolved);
  return { centre: zone.start + Math.PI / 4, half: (rot.passWindow / 2) * ctx.rate, zone };
}

/** One tick of the handle. Mutates `handle` through the returned state. */
export function updateHandle(
  handle: HandleState,
  rot: RotationState,
  passPressed: boolean,
  ctx: HandleContext,
  cfg: SimConfig,
  dt: number,
): { handle: HandleState; result: HandleResult } {
  const result: HandleResult = { passed: false, dropped: false, wentBlind: false, cameOut: false };
  if (handle === 'dropped') return { handle, result };
  if (rot.passTimer > 0) {
    rot.passTimer = Math.max(0, rot.passTimer - dt);
    if (rot.passTimer === 0 && handle === 'passing') handle = 'inFront';
  }
  const w = passWindowOf(rot, ctx);
  if (!w) return { handle, result };
  const p = handleProgress(rot);

  if (handle === 'behind') {
    // Spinning back the way it came brings the handle round to the front again.
    const prev = passZone(rot.spinSide!, rot.zonesResolved - 1);
    if (p <= prev.start) {
      handle = 'inFront';
      rot.zonesResolved -= 1;
      rot.stoppedByRope = false;
      result.cameOut = true;
    }
    return { handle, result };
  }
  if (handle === 'passing') return { handle, result };

  if (passPressed) {
    if (Math.abs(p - w.centre) <= w.half) {
      rot.passes += 1;
      rot.zonesResolved += 1;
      rot.passTimer = cfg.handlePass.passTime;
      result.passed = true;
      return { handle: 'passing', result };
    }
    result.dropped = true;
    return { handle: 'dropped', result };
  }

  const missedBackside = rot.spinSide === 'backside' && p >= w.zone.end;
  const missedFrontside = rot.spinSide === 'frontside' && p > w.centre + w.half;
  if (missedBackside || missedFrontside) {
    if (!ctx.inAir) {
      result.dropped = true;
      return { handle: 'dropped', result };
    }
    if (missedBackside) {
      // The rope stops the spin with the handle behind the back: blind.
      rot.spinAngle = (w.zone.end - rot.progressOffset) * rot.startDir;
      rot.spinRate = 0;
      rot.spinTarget = null;
      rot.stoppedByRope = true;
      rot.blindDir = rot.startDir;
      rot.zonesResolved += 1;
      result.wentBlind = true;
      return { handle: 'behind', result };
    }
    // Frontside: the rope unwinds the rider back to the half turn.
    rot.spinTarget = (w.zone.start - rot.progressOffset) * rot.startDir;
    rot.stoppedByRope = true;
    rot.spinRate = -rot.startDir * ctx.rate;
  }
  return { handle, result };
}
