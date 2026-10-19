import { DT, GRAVITY } from '../config';
import { type FeatureLocal, toLocal } from '../features';
import { pieceCentre, pieceHeightAt, type RidePiece } from '../featureShapes';
import type { InputFrame } from '../input';
import { atan2, cos, sin } from '../math/detmath';
import { approach, clamp, lerp, wrapAngle } from '../math/scalar';
import { dot, forwardOf, rightOf, scale, vec3 } from '../math/vec';
import { toeSign } from '../edge';
import type { ResolvedFeature } from '../park';
import type { AirState, ApproachState, CrashReason } from '../rider';
import type { SimConfig } from '../config';
import type { SimState } from '../world';
import { boardYawInAir } from './entryResolver';
import { maxReachableHeight, type SideType } from './slideOnConfig';
import { partEnd } from './slideController';

/**
 * Slide-on (side approaches spec): side entries lift the nose over the side
 * edge of a feature's top and slide the base on. This part reads the
 * approach (spec 3): the turn-in, the inward speed, where the board will
 * meet the edge, what kind of edge it is and whether a slide-on is possible.
 */

/** Why a slide-on is not available ('' when it is). */
export type SlideOnBlock = '' | 'front' | 'range' | 'angle' | 'distance' | 'noTop' | 'wall' | 'height' | 'end';

/**
 * Side edge type of a feature's top (derived from the ride data unless the
 * feature def sets `sideType`): round profiles are Round (pipes), narrow
 * flat tops thin rails, a pyramid's top is surrounded by banks, wall
 * pieces are walls; any other flat top has the validator's rounded edge.
 */
export function sideTypeOf(f: ResolvedFeature, p: RidePiece, s: SimState): SideType {
  if (f.def.sideType) return f.def.sideType;
  if (p.wall) return 'Wall';
  if (p.profile === 'Round') return 'Round';
  if (f.shape.pieces.some((q) => q.cap !== null)) return 'Bank';
  if (p.width < s.cfg.slideOn.RailMaxWidth) return 'Rail';
  return 'Rounded';
}

/**
 * The slide piece of a feature's top under `u` (along its axis), if any; on
 * a multi-lane feature (Transfer) the lane whose centre is nearest `v`.
 */
export function topPieceAt(f: ResolvedFeature, u: number, v = 0): RidePiece | null {
  let best: RidePiece | null = null;
  let bestOff = Infinity;
  for (const p of f.shape.pieces) {
    if (!p.slide || p.axis !== 'u' || p.wall || u < p.u0 || u > p.u1) continue;
    const off = Math.abs(v - pieceCentre(p, u));
    if (off < bestOff) {
      best = p;
      bestOff = off;
    }
  }
  return best;
}

/**
 * Fill the slide-on fields of an approach (spec 3): `l` is the board's
 * position in the feature frame, `toStart` and `sideGap` as the tracker
 * measured them.
 */
export function assessSlideOn(s: SimState, f: ResolvedFeature, l: FeatureLocal, a: ApproachState): void {
  const { rider: r, cfg } = s;
  const S = cfg.slideOn;
  const sh = f.shape;
  const along = dot(r.vel, forwardOf(f.heading));
  const across = dot(r.vel, rightOf(f.heading));
  // Toward the feature: +v from its left side, -v from its right.
  const toward = l.v < sh.vMin ? 1 : l.v > sh.vMax ? -1 : 0;
  const inward = across * toward;
  a.inwardSpeed = inward;
  a.turnIn = toward === 0 ? 0 : atan2(inward, Math.abs(along));
  // Where the board meets the edge, carrying on as it goes.
  a.contactU = toward !== 0 && inward > 0.05 ? l.u + (along * a.sideGap) / inward : l.u;
  const edge = topPieceAt(f, a.contactU, l.v);
  a.sideType = edge ? sideTypeOf(f, edge, s) : 'Rounded';
  a.edgeRadius = edge ? edge.radius : 0;
  let p = edge;
  if (edge && edge.cap && toward !== 0 && inward > 0.05) {
    // A bank: the board reaches the flat top only after climbing its run.
    a.contactU += (along * (edge.cap.half - edge.cap.halfTop)) / inward;
    p = topPieceAt(f, a.contactU, l.v);
  }
  a.topHeight = p ? pieceHeightAt(p, a.contactU).height : 0;
  a.remaining = p ? partEnd(f, p.part) - a.contactU : 0;
  a.maxHeight = maxReachableHeight(cfg, 1, S.MaxNoseLift, a.sideType, a.speed, Math.max(a.turnIn, S.MinAngle));
  a.slideOnBlock =
    toward === 0
      ? 'front'
      : a.toStart > S.TrackRange
        ? 'range'
        : a.turnIn < S.MinAngle || a.turnIn > S.MaxAngle
          ? 'angle'
          : a.sideGap < S.MinLateral || a.sideGap > S.MaxLateral
            ? 'distance'
            : !p
              ? 'noTop'
              : a.sideType === 'Wall' || (f.def.sideWall ?? 0) > S.WallBlock
                ? 'wall'
                : a.topHeight > a.maxHeight
                  ? 'height'
                  : a.remaining < S.MinRemaining
                    ? 'end'
                    : '';
}

/**
 * Blocks that still leave a side entry to try (v2 spec 2: the cue may be
 * off, the physics decides): any turn-in, too high, too near the end. Too
 * far off the side, no top there, a wall or in front of the feature is not
 * a side approach.
 */
const tryable = (a: ApproachState): boolean =>
  a.slideOnBlock === '' || a.slideOnBlock === 'height' || a.slideOnBlock === 'end' || a.slideOnBlock === 'angle';

/**
 * Edge load at the pop (v2 spec 1.1): the edge (0..1 of the most) if it
 * carves toward the feature on the approach, times the rope tension over
 * EdgeTensionRef (clamped). 0 with no side approach or a flat board. It is
 * the edge's: any side approach the tracker sees, even one too far off for
 * a slide-on (a big air-on).
 */
export function edgeLoadAt(s: SimState): number {
  const { rider: r, cfg } = s;
  const S = cfg.slideOn;
  const a = r.approach;
  if (!a || a.side === 'front') return 0;
  const f = s.features.find((x) => x.def.id === a.featureId);
  if (!f) return 0;
  // World side the edge carves toward (+1 right of travel), and the feature's side.
  const carve = -toeSign(r) * Math.sign(r.edgeAngle);
  const featureRight = toLocal(f, r.pos).v < f.shape.vMin ? 1 : -1;
  const travelRight = dot(rightOf(r.heading), rightOf(f.heading)) >= 0 ? featureRight : -featureRight;
  if (carve === 0 || carve !== travelRight) return 0;
  const edge = Math.min(1, Math.abs(r.edgeAngle) / cfg.edge.maxEdgeAngle);
  return edge * clamp(r.ropeTension / S.EdgeTensionRef, S.EdgeTensionMin, S.EdgeTensionMax);
}

/**
 * The water pop beside a feature (spec 2, 4.1; v2 spec 1.1). Any side
 * approach the pop (with the edge's release) carries toward the feature has
 * the side-entry height (`SidePopScale` of the ollie, so subtract the rest of
 * `popSpeed`) plus the edge's pop bonus, and the edge's release adds inward
 * speed. Near enough to try a slide-on, the slide-on starts and the nose
 * lifts. Returns true when a slide-on is on.
 */
export function predictSlideOn(s: SimState, air: AirState, popSpeed: number, edgeLoad = 0): boolean {
  const { rider: r, cfg } = s;
  const S = cfg.slideOn;
  const a = r.approach;
  if (!a || a.side === 'front') return false;
  if (a.inwardSpeed + S.EdgeReleaseBonus * edgeLoad <= 0.05) return false;
  const f = s.features.find((x) => x.def.id === a.featureId);
  if (!f) return false;
  const l = toLocal(f, r.pos);
  const toward = l.v < f.shape.vMin ? 1 : -1;
  const push = scale(rightOf(f.heading), toward * S.EdgeReleaseBonus * edgeLoad);
  r.vel = vec3(r.vel.x + push.x, r.vel.y - popSpeed * (1 - S.SidePopScale) + S.EdgePopBonus * edgeLoad, r.vel.z + push.z);
  if (!tryable(a)) return false;
  air.slideOn = {
    featureId: f.def.id,
    featureHeading: f.heading,
    toward,
    target: S.AutoNoseLift,
    pitch: 0,
    sinceRelease: 0,
    phase: 'air',
    lead: 'nose',
    p: 0,
    vin: 0,
    vin0: 0,
    vy: 0,
    y0: 0,
    top: 0,
    type: a.sideType,
    yaw0: 0,
    u: 0,
    v: 0,
    along: 0,
    part: 0,
    bankRun: 0,
    scrape: 0,
    edgeLoad,
  };
  return true;
}

/** Nose lift in the air: to the automatic lift in NoseLiftTime; W within WWindow of the release lifts it to the most. */
export function stepNoseLift(s: SimState, air: AirState, input: InputFrame): void {
  const so = air.slideOn;
  if (!so || so.phase !== 'air') return;
  const S = s.cfg.slideOn;
  so.sinceRelease += DT;
  if (input.forward && so.sinceRelease <= S.WWindow) so.target = S.MaxNoseLift;
  so.pitch = approach(so.pitch, so.target, (S.MaxNoseLift / S.NoseLiftTime) * DT);
}

/** Board angle to the feature axis in the air (rad, + turned toward its right). */
const yawToAxis = (air: AirState, f: ResolvedFeature): number => wrapAngle(boardYawInAir(air) - f.heading);

/** Near 90 degrees to the axis (from EdgeLeadAngle): the board's edge leads (an edge slide-on). */
export const edgeLeads = (yaw: number, cfg: SimConfig): boolean => Math.abs(sin(yaw)) > sin(cfg.slideOn.EdgeLeadAngle);

/**
 * In the air: has the board's leading point (the nose, or the leading edge
 * when the board is across) just passed over the near side edge of the top?
 * Then decide (spec 4.2, v2 spec 2-3):
 * - the whole board clears the top: fly on ('cleared'), a side ollie-on with air;
 * - the leading point is over the edge, or under it by no more than the
 *   edge's NoseTolerance: the contact phase starts ('contact');
 * - lower, within ScrapeBand, or with the board's middle less than DigDepth under the top: it
 *   scrapes up (contact with a speed loss, sketchy when deep);
 * - lower still with the board's middle deep under the top: the nose digs in;
 * - a thin rail is a short round edge: the base rides up over it the same
 *   way (its nose tolerance is small);
 * - a bank never digs: the board rides up it.
 * Returns null while the board has not reached the edge.
 */
export function leadCrossing(s: SimState, air: AirState): 'cleared' | 'contact' | CrashReason | null {
  const { rider: r, cfg } = s;
  const S = cfg.slideOn;
  const so = air.slideOn;
  if (!so || so.phase !== 'air') return null;
  const f = s.features.find((x) => x.def.id === so.featureId);
  if (!f) return null;
  const l = toLocal(f, r.pos);
  const yaw = yawToAxis(air, f);
  const edge = edgeLeads(yaw, cfg);
  const reach = edge ? S.BaseWidth / 2 : (S.BoardLength / 2) * Math.abs(sin(yaw));
  const leadU = edge ? l.u : l.u + (S.BoardLength / 2) * Math.abs(cos(yaw));
  const leadV = l.v + so.toward * reach;
  const p = topPieceAt(f, leadU, leadV);
  if (!p) return null;
  const edgeV = pieceCentre(p, leadU) - so.toward * (p.width / 2);
  if (so.toward * (leadV - edgeV) < 0) return null;
  const top = pieceHeightAt(p, leadU).height;
  const half = edge ? S.BaseWidth / 2 : S.BoardLength / 2;
  const lift = half * sin(so.pitch);
  const lead = r.pos.y + lift;
  const low = r.pos.y - lift;
  const type = sideTypeOf(f, p, s);
  so.type = type;
  so.lead = edge ? 'edge' : 'nose';
  so.part = p.part;
  so.bankRun = p.cap ? p.cap.half - p.cap.halfTop : 0;
  if (low >= top + cfg.featureRide.Entry.Clearance) {
    so.phase = 'cleared';
    return 'cleared';
  }
  const tol = S.NoseTolerance[type];
  // How far the nose is under its tolerance (0 when it is within it).
  const under = Math.max(0, top - tol - lead);
  const vin = Math.max(0, so.toward * dot(r.vel, rightOf(f.heading)));
  // Just popped and rising fast, the board still rides up the face: only a board that cannot climb it digs in.
  const energy = 0.5 * Math.max(0, r.vel.y) * Math.max(0, r.vel.y) + 0.5 * vin * vin * S.ClimbEfficiency;
  if (under > S.ScrapeBand && energy < GRAVITY * (top - r.pos.y) && type !== 'Bank') return 'noseDig';
  // Into the contact phase.
  so.phase = 'contact';
  so.scrape = under;
  so.p = 0;
  so.vin = Math.max(0, so.toward * dot(r.vel, rightOf(f.heading)));
  so.vin0 = so.vin;
  so.vy = Math.max(0, r.vel.y);
  so.y0 = r.pos.y;
  so.top = top;
  so.yaw0 = yaw;
  so.u = l.u;
  so.v = l.v;
  so.along = dot(r.vel, forwardOf(f.heading));
  return 'contact';
}

/**
 * One tick of the contact phase (spec 4.2.3), in SubSteps steps: the
 * contact point runs back along the board as it moves inward (at the inward
 * speed over the board's sideways share), the board's middle climbs from
 * where it met the edge to the top, the nose comes down flat and the board
 * turns onto the axis. The climb is paid by the upward speed left at contact,
 * then by the inward kinetic energy (x ClimbEfficiency, less the edge's
 * scrape); the rope's pull toward the feature helps (x RopeAssistScale).
 * Below HangUpSpeed inward it finishes the climb when the board's middle is
 * within HangUpDrop of the top, else hangs. Returns 'done' with the tail on
 * top, 'hang' when it stops short, else null.
 */
export function stepContact(s: SimState, air: AirState): 'done' | 'hang' | null {
  const { rider: r, cfg } = s;
  const S = cfg.slideOn;
  const so = air.slideOn!;
  const f = s.features.find((x) => x.def.id === so.featureId)!;
  const n = S.SubSteps;
  const dt = DT / n;
  const m = cfg.rider.mass;
  const ropeIn = (S.RopeAssistScale * so.toward * dot(r.ropeForce, rightOf(f.heading))) / m;
  // The board's sideways extent (at least a tenth of it), plus a bank's run from the foot to the flat top.
  const length = (so.lead === 'edge' ? S.BaseWidth : S.BoardLength * Math.max(Math.abs(sin(so.yaw0)), 0.1)) + so.bankRun;
  const climbTo = so.top - (so.type === 'Round' ? S.RoundTailAllowance : 0);
  for (let i = 0; i < n; i++) {
    const dp = Math.min(1 - so.p, (so.vin * dt) / length);
    let work = GRAVITY * Math.max(0, climbTo - so.y0) * dp + S.EdgeFriction[so.type] * dp - ropeIn * so.vin * dt;
    // Upward speed left at contact pays first.
    const ev = 0.5 * so.vy * so.vy;
    const take = Math.min(ev, Math.max(work, 0));
    so.vy = Math.sqrt(2 * (ev - take));
    work -= take;
    const v2 = so.vin * so.vin - (2 * work) / S.ClimbEfficiency;
    so.u += so.along * dt;
    if (v2 <= S.HangUpSpeed * S.HangUpSpeed) {
      so.vin = Math.sqrt(Math.max(0, v2));
      // Close to the top the legs finish the climb.
      if (so.top - lerp(so.y0, so.top, so.p) <= S.HangUpDrop) {
        so.p = 1;
        break;
      }
      return 'hang';
    }
    so.vin = Math.sqrt(v2);
    so.v += so.toward * so.vin * dt;
    so.p += dp;
    if (so.p >= 1) {
      so.p = 1;
      break;
    }
  }
  // The board follows: the middle rises to the top, the nose comes down flat.
  so.pitch = lerp(so.target, 0, so.p);
  const y = lerp(so.y0, so.top, so.p);
  const fwd = forwardOf(f.heading);
  const right = rightOf(f.heading);
  const o = f.origin;
  r.pos = vec3(o.x + fwd.x * so.u + right.x * so.v, y, o.z + fwd.z * so.u + right.z * so.v);
  r.vel = vec3(fwd.x * so.along + right.x * so.toward * so.vin, 0, fwd.z * so.along + right.z * so.toward * so.vin);
  return so.p >= 1 ? 'done' : null;
}

/**
 * Coyote time (v2 spec 2): charging the pop beside a feature, the board's
 * nose has reached its side edge on the water. The pop goes off now, as if
 * released on time (a little lower: CoyotePenalty).
 */
export function coyoteContact(s: SimState): boolean {
  const { rider: r, cfg } = s;
  const a = r.approach;
  if (!a || a.side === 'front' || !tryable(a) || a.inwardSpeed <= 0) return false;
  return a.sideGap <= (cfg.slideOn.BoardLength / 2) * Math.abs(sin(a.turnIn)) + 0.05;
}

/**
 * A side approach is on (v2 spec 1): beside a feature the tracker sees,
 * moving or carving toward it. The edge held into the pop is then the edge ollie,
 * so a water trick does not arm.
 */
export function sideApproachOn(s: SimState): boolean {
  const a = s.rider.approach;
  if (!a || a.side === 'front') return false;
  return a.inwardSpeed > 0.05 || edgeLoadAt(s) > 0;
}

/** Beside a feature within reach (v2 spec 2): W at the pop lifts the nose, it never flips. */
export function besideFeature(s: SimState): boolean {
  const a = s.rider.approach;
  return !!a && a.side !== 'front' && a.sideGap <= s.cfg.slideOn.MaxLateral && a.toStart <= s.cfg.slideOn.TrackRange;
}
