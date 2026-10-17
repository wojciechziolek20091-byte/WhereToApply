import { DT } from '../config';
import { toeSign } from '../edge';
import { updateHandle } from '../handle';
import type { InputMemory } from '../input';
import { approach, mod } from '../math/scalar';
import { dot, forwardOf, rightOf } from '../math/vec';
import { rotationSide } from '../rotation';
import type { CrashReason, JibState, RiderState, RotationSide } from '../rider';
import type { SlideId } from '../tricks/data';
import type { SimState } from '../world';
import { cos } from '../math/detmath';
import { isBoardslide } from './slideController';
import { slopedTurnHit } from './featureSpecials';

/**
 * FeatureRotation (feature riding spec 5.2-5.4): which slide a board angle
 * is, and rotating on the feature in 90-degree hop steps.
 *
 * Naming (5.2). From a side approach the feature's side names it: on the
 * heelside backside, on the toeside frontside; the nose crossing over the
 * feature makes a boardslide, the tail a lipslide. A backside boardslide
 * ends chest forward, a frontside one back forward. Front entries and
 * rotations on the feature have no approach side: chest forward is a
 * backside boardslide, back forward a frontside one (lipslides only come
 * from side entries).
 */

/** Slide side of a slide id (50-50s and wall rides have none). */
export const slideSide = (id: SlideId): RotationSide | null =>
  id === 'backboard' || id === 'backLip' ? 'backside' : id === 'frontboard' || id === 'frontLip' ? 'frontside' : null;

/**
 * A 90-degree side entry (spec 5.2): `boardYaw` at contact (world),
 * `featureHeading` its axis, `fromSide` the feature side the board came in
 * over (+1 its right), `toes` +1 when the rider's toes pointed right of
 * `takeoffHeading` on the approach.
 */
export function sideEntrySlide(boardYaw: number, featureHeading: number, fromSide: number, toes: number, takeoffHeading: number): SlideId {
  // From the rider toward (and across) the feature.
  const across = rightOf(featureHeading);
  const toward = { x: -fromSide * across.x, y: 0, z: -fromSide * across.z };
  const toeDir = rightOf(takeoffHeading);
  const frontside = dot(toeDir, toward) * toes > 0;
  const lip = dot(forwardOf(boardYaw), toward) < 0;
  return lip ? (frontside ? 'frontLip' : 'backLip') : frontside ? 'frontboard' : 'backboard';
}

/**
 * Slide name for a board angle on the feature: parallel is a 50-50 (switch
 * after a half turn), across it the chest rule; a side entry's slide keeps
 * the name its approach gave it until the board turns.
 */
export function slideIdAt(boardAngle: number, featureHeading: number, travelHeading: number, r: RiderState, j: JibState | null = null): SlideId {
  const k = Math.round(boardAngle / (Math.PI / 2));
  const m = mod(k, 4);
  if (m === 0) return r.switchStance ? 'switchFiftyFifty' : 'fiftyFifty';
  if (m === 2) return r.switchStance ? 'fiftyFifty' : 'switchFiftyFifty';
  if (j && j.entrySlide && k * (Math.PI / 2) === j.entryAngle) return j.entrySlide;
  const chest = featureHeading + boardAngle + (toeSign(r) * Math.PI) / 2;
  return cos(chest - travelHeading) > 0 ? 'backboard' : 'frontboard';
}

/**
 * One tick of rotation on the feature. A/D held past `feature.tapTime`
 * starts a 90-degree hop step (`rotateTimePer90`); held on through it, the
 * steps chain into one rotation (180, 270...). A step against the current
 * slide's side (a backside rotation out of a frontside slide) is the hard
 * way: allowed, with a balance hit. Backside rotations through the pass
 * zone need Q in the window (`handlePass.featureWindow`), or the handle
 * drops. Returns a crash reason, or null.
 */
export function stepFeatureRotation(s: SimState, j: JibState, heading: number, mem: InputMemory): CrashReason | null {
  const { rider: r, cfg } = s;
  const R = cfg.featureRide.Rotation;
  const stepRate = Math.PI / 2 / cfg.feature.rotateTimePer90;
  if (j.boardAngle === j.targetAngle && mem.steerDir !== 0 && mem.steerHeldTime >= cfg.feature.tapTime) {
    const dir = mem.steerDir;
    const side = rotationSide(dir, heading + j.boardAngle, toeSign(r), r.ropeHeading);
    if (j.rot.spinSide === null) {
      j.rot.spinSide = side;
      j.rot.startDir = dir;
    }
    j.rot.spinDir = dir;
    const from = slideIdAt(j.boardAngle, heading, heading, r, j);
    const fromSide = isBoardslide(j.boardAngle) ? slideSide(from) : null;
    const hardWay = fromSide !== null && side !== fromSide;
    const last = j.rotations.length > 0 ? j.rotations[j.rotations.length - 1]! : null;
    if (last && last.dir === dir && last.endTick >= s.tick - 1) {
      // Held on through the step: the same rotation goes on.
      last.deg += 90;
      last.hardWay = last.hardWay || hardWay;
    } else {
      j.rotations.push({ deg: 90, dir, side, hardWay, from, endTick: -1, atTime: j.time });
    }
    const hit = (hardWay ? R.HardWayHit : 0) + slopedTurnHit(j, s);
    if (hit > 0 && cfg.feature.balanceEnabled) j.balance += hit * (j.balance >= 0 ? 1 : -1);
    j.entrySlide = null;
    j.targetAngle = j.boardAngle + (dir * Math.PI) / 2;
  }
  const was = j.boardAngle;
  j.boardAngle = approach(j.boardAngle, j.targetAngle, stepRate * DT);
  if (was !== j.boardAngle && j.boardAngle === j.targetAngle && j.rotations.length > 0) j.rotations[j.rotations.length - 1]!.endTick = s.tick;
  j.rot.spinAngle = j.boardAngle - j.entryAngle;
  j.rot.maxSpin = Math.max(j.rot.maxSpin, Math.abs(j.rot.spinAngle));
  const h = updateHandle(r.handle, j.rot, mem.passPressed, { rate: stepRate, inAir: false }, cfg, DT);
  r.handle = h.handle;
  if (h.result.passed) s.events.push({ type: 'handlePass', tick: s.tick });
  return h.result.dropped ? 'handleDropped' : null;
}

/** Still turning between two 90-degree positions (running off the end now crashes). */
export const midRotation = (j: JibState): boolean => j.boardAngle !== j.targetAngle;
