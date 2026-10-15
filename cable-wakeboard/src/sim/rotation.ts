import type { SimConfig } from './config';
import { approach, sign, TAU, wrapAngle } from './math/scalar';
import type { RotationSide, RotationState } from './rider';

/**
 * Rotation tracker (spec section 7.2): spin around world up from A/D, flip
 * around the board's long axis from W / S. A released spin carries on to the
 * next half turn if it is within `spin.maxCarry`, otherwise it stops there
 * (under-rotated); flips carry to the next whole turn within `flip.maxCarry`.
 */

export function createRotation(passWindow: number): RotationState {
  return {
    spinAngle: 0,
    spinRate: 0,
    spinTarget: null,
    spinDir: 0,
    startDir: 0,
    progressOffset: 0,
    spinSide: null,
    maxSpin: 0,
    flipAngle: 0,
    flipRate: 0,
    flipTarget: null,
    passWindow,
    zonesResolved: 0,
    passes: 0,
    passTimer: 0,
    stoppedByRope: false,
    blindDir: 0,
  };
}

/** Chest direction (rad): the toe side of the board. `toes` is +1 when the toes point right of the board's heading. */
export const chestHeading = (boardYaw: number, toes: number): number => boardYaw + (toes * Math.PI) / 2;

/**
 * Frontside when the chest turns toward the pull first, backside when the
 * back does (spec section 2.2). `dir` is the spin direction (+1 clockwise from
 * above), `ropeHeading` points from the rider to the carrier.
 */
export function rotationSide(dir: number, boardYaw: number, toes: number, ropeHeading: number): RotationSide {
  const toRope = wrapAngle(ropeHeading - chestHeading(boardYaw, toes));
  const toward = toRope >= 0 ? 1 : -1;
  return toward === dir ? 'frontside' : 'backside';
}

/** Where a released rotation settles: the next multiple of `step` ahead, if within `maxCarry`; else where it is. */
export function carryTarget(angle: number, rate: number, step: number, maxCarry: number): number {
  const d = sign(rate);
  if (d === 0) return angle;
  const next = d > 0 ? Math.ceil(angle / step) * step : Math.floor(angle / step) * step;
  return Math.abs(next - angle) <= maxCarry ? next : angle;
}

/** Advance a rotation toward `target` at `rate`; snaps and returns true on arrival. */
function carry(angle: number, target: number, rate: number, dt: number): { angle: number; done: boolean } {
  const next = approach(angle, target, rate * dt);
  return { angle: next, done: next === target };
}

/**
 * One tick of spin. `want` is -1, 0 or 1 (A/D). `side` is evaluated by the
 * caller when a spin starts (it needs the rope). A spin stopped by the rope
 * cannot keep going the same way; spinning back is allowed.
 */
export function stepSpin(rot: RotationState, want: number, side: () => RotationSide, cfg: SimConfig, dt: number, rate: number): void {
  const accel = rate / cfg.spin.accelTime;
  const blocked = rot.stoppedByRope && want === rot.spinDir;
  if (want !== 0 && !blocked) {
    if (rot.spinSide === null) {
      rot.spinSide = side();
      rot.startDir = want;
    }
    if (want !== rot.spinDir) rot.spinDir = want;
    rot.spinTarget = null;
    rot.stoppedByRope = false;
    rot.spinRate = approach(rot.spinRate, want * rate, accel * dt);
    rot.spinAngle += rot.spinRate * dt;
  } else if (rot.spinTarget === null && rot.spinRate !== 0) {
    rot.spinTarget = carryTarget(rot.spinAngle, rot.spinRate, Math.PI, cfg.spin.maxCarry);
  }
  if (rot.spinTarget !== null) {
    const c = carry(rot.spinAngle, rot.spinTarget, rate, dt);
    rot.spinAngle = c.angle;
    rot.spinRate = c.done ? 0 : sign(rot.spinTarget - rot.spinAngle) * rate;
    if (c.done) rot.spinTarget = null;
  }
  rot.maxSpin = Math.max(rot.maxSpin, Math.abs(rot.spinAngle));
}

/** One tick of flip: `want` +1 front flip (W), -1 tantrum (S), 0 released. */
export function stepFlip(rot: RotationState, want: number, cfg: SimConfig, dt: number, rateScale: number): void {
  const rate = cfg.flip.rate * rateScale;
  if (want !== 0) {
    rot.flipTarget = null;
    rot.flipRate = want * rate;
    rot.flipAngle += rot.flipRate * dt;
  } else if (rot.flipTarget === null && rot.flipRate !== 0) {
    rot.flipTarget = carryTarget(rot.flipAngle, rot.flipRate, TAU, cfg.flip.maxCarry);
  }
  if (rot.flipTarget !== null) {
    const c = carry(rot.flipAngle, rot.flipTarget, rate, dt);
    rot.flipAngle = c.angle;
    rot.flipRate = c.done ? 0 : sign(rot.flipTarget - rot.flipAngle) * rate;
    if (c.done) rot.flipTarget = null;
  }
}

/** Angle between the chest and the rope (rad), signed: what the handle system and animation look at. */
export const ropeRelativeYaw = (boardYaw: number, toes: number, ropeHeading: number): number =>
  wrapAngle(chestHeading(boardYaw, toes) - ropeHeading);
