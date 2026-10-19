import { atan } from '../math/detmath';
import { type FeatureLocal, type FeatureSurface, toLocal } from '../features';
import { pieceCentre, type RidePiece } from '../featureShapes';
import { evaluateLanding, type LandingResult } from '../landing';
import { clamp, lerp, sign, wrapAngle } from '../math/scalar';
import { add, dot, forwardOf, rightOf, scale } from '../math/vec';
import type { ResolvedFeature } from '../park';
import type { AirState, CrashReason, JibEntry } from '../rider';
import type { SlideId } from '../tricks/data';
import { toeSign } from '../edge';
import { sideEntrySlide } from './featureRotation';
import { isBoardslide } from './slideController';
import { alignSlide } from './slideOnConfig';
import type { SimState } from '../world';

/**
 * EntryResolver (feature riding spec sections 3 and 4): every way onto a
 * feature resolves here so the rules stay the same. Three moments:
 *
 *   startEntry     the water pop near a feature: remember the approach (side,
 *                  angle, a hard edge still on) and add the side hop.
 *   crossEdge      the board flies onto a part across its front or side edge:
 *                  clearance (ShortOllie / ClippedSide / tail clip) and the
 *                  side approach angle (NoseHitSide).
 *   resolveLanding contact with a main: base roll (SlippedOut), snap to a
 *                  slide angle (BadAngle), position across the balance width
 *                  (ClippedSide / Overshoot), impact and skid.
 */

export interface EntryResult {
  kind: JibEntry;
  success: boolean;
  /** Board angle to the feature axis it snapped to (rad, a multiple of 90 degrees). */
  boardAngle: number;
  /** Spin in the air before contact (rad, signed). */
  inRotation: number;
  /** 0..1. */
  quality: number;
  failReason: CrashReason | null;
  sketchy: boolean;
  /** Balance meter after the entry (+ to the feature's right). */
  balance: number;
  /** Speed kept along the feature. */
  speedKeep: number;
  /** A side entry across the feature: its slide by approach side and which end crossed (else null: named on the feature). */
  slide: SlideId | null;
  /** From the side: speed still carrying it across (m/s). */
  carry: number;
  landing: LandingResult;
}

/** Folded angle between a direction and a feature axis (rad, 0..PI/2): a feature can be met from either end. */
const axisAngle = (a: number): number => {
  const w = Math.abs(wrapAngle(a));
  return w > Math.PI / 2 ? Math.PI - w : w;
};

/**
 * The water pop: what the ApproachTracker saw is kept for the landing. With
 * the feature beside the rider (within SideEntry.MaxLateral) and A/D held
 * toward it, the pop hops sideways toward it, harder with more charge.
 */
export function startEntry(s: SimState, air: AirState, steer: number, charge: number): void {
  const { rider: r, cfg } = s;
  const a = r.approach;
  if (!a) return;
  const R = cfg.featureRide;
  const f = s.features.find((x) => x.def.id === a.featureId);
  if (!f) return;
  // A side approach pops off its edge (v2 spec 1.1): only a front approach slips out.
  const slipping = a.side === 'front' && a.edgeAge <= R.Landing.SlipWindow;
  const slip = a.side === 'heelside' ? R.Landing.SlipRollHeelside : a.side === 'toeside' ? R.Landing.SlipRollToeside : R.Landing.SlipRollFront;
  let hop = 0;
  // The hop toward it, unless the edge's release already carries the slide-on there.
  if (!air.slideOn && a.side !== 'front' && a.sideGap <= R.SideEntry.MaxLateral && steer !== 0 && steer === a.featureSide) {
    hop = lerp(R.SideEntry.HopLateralVMin, R.SideEntry.HopLateralVMax, charge);
    // Across the feature axis, toward its centre line.
    r.vel = add(r.vel, scale(rightOf(f.heading), -sign(a.lateral) * hop));
  }
  air.entry = { featureId: a.featureId, side: a.side, angle: axisAngle(a.angle), hop, roll: slipping ? slip : 0 };
}

/** Start of a part along the feature axis. */
const partU0 = (f: ResolvedFeature, part: number): number => {
  let u0 = Infinity;
  for (const q of f.shape.pieces) if (q.part === part && q.axis === 'u' && q.u0 < u0) u0 = q.u0;
  return u0;
};

/**
 * The board has just flown over a part (a main, or a safety) it was not over
 * last tick. Which edge did it cross? The one it crossed most recently, from
 * the distance in and the speed through each. Then the clearance: the base
 * must be `Entry.Clearance` above the top; short by up to
 * `TailClipTolerance` is a tail clip (sketchy), more is a crash. Over a
 * side edge the nose tolerance and the scrape band are added (side approach
 * v2 spec 2: a scrape-up), and any angle goes; lower is a NoseDig.
 */
export function crossEdge(s: SimState, air: AirState, f: ResolvedFeature, local: FeatureLocal, surface: FeatureSurface, part: string): CrashReason | null {
  const { rider: r, cfg } = s;
  const E = cfg.featureRide.Entry;
  const p = surface.piece;
  const vu = dot(r.vel, forwardOf(f.heading));
  const vv = dot(r.vel, rightOf(f.heading));
  const off = local.v - pieceCentre(p, local.u);
  const inward = -sign(off) * vv;
  const tFront = vu > 0 ? (local.u - partU0(f, p.part)) / vu : Infinity;
  const tSide = inward > 0 ? (p.width / 2 - Math.abs(off)) / inward : Infinity;
  const side = tSide < tFront ? (off >= 0 ? 1 : -1) : 0;
  air.crossing = { featureId: f.def.id, part, side, height: surface.height };
  const short = surface.height + E.Clearance - r.pos.y;
  const S = cfg.slideOn;
  // From the side (v2 spec 2) a board a little low scrapes up the edge; well below it the nose digs in.
  const allow = E.TailClipTolerance + (side !== 0 ? S.NoseTolerance.Rounded + S.ScrapeBand : 0);
  if (short > allow) return side === 0 ? 'shortOllie' : 'noseDig';
  if (short > 0) air.tailClip = true;
  return null;
}

/** Half-width either side of the centre line the board has to land in (spec 3.3, 4.6). */
export function balanceHalfWidth(p: RidePiece, s: SimState): number {
  const S = s.cfg.featureRide.SideEntry;
  if (p.profile === 'Round') return S.PipeHalfWidth;
  if (p.width < S.RailMaxWidth) return S.RailHalfWidth;
  return Math.max((p.width - S.BoxEdgeMargin) / 2, S.RailHalfWidth);
}

/** Board yaw in the air: the takeoff direction turned by the spin (a sideways hop drifts the board, it does not turn it). */
export const boardYawInAir = (air: AirState): number => air.takeoffHeading + air.rot.spinAngle;

/**
 * Contact with a main (spec 4). `heading` is the piece's direction. The
 * checks run in the spec's order; a sketchy one adds to the balance hit and
 * cuts the quality, a failed one ends it.
 */
export function resolveLanding(s: SimState, air: AirState, f: ResolvedFeature, surface: FeatureSurface, local: FeatureLocal, heading: number): EntryResult {
  const { rider: r, cfg } = s;
  const L = cfg.featureRide.Landing;
  const S = cfg.featureRide.SideEntry;
  const part = `${f.def.id}:${surface.piece.part}`;
  const crossSide = air.crossing && air.crossing.part === part ? air.crossing.side : 0;
  const kind: JibEntry = air.pendingEntry
    ? air.pendingEntry
    : air.featureId !== null && (air.featureId !== f.def.id || (air.cleared.length > 0 && air.cleared[0] !== part))
      ? 'transfer'
      : crossSide !== 0
        ? 'sideOllieOn'
        : 'ollieOn';
  const yaw = wrapAngle(boardYawInAir(air) - heading);
  // From the side any angle lines up into a slide (v2 spec 2); else the nearest 90.
  const aligned = crossSide !== 0 ? alignSlide(yaw, cfg) : null;
  const boardAngle = aligned ? aligned.boardAngle : Math.round(yaw / (Math.PI / 2)) * (Math.PI / 2);
  const level = { ...air, rot: { ...air.rot, spinAngle: Math.round(air.rot.spinAngle / Math.PI) * Math.PI } };
  const landing = evaluateLanding(r, level, surface.normal, cfg);
  const result: EntryResult = {
    kind,
    success: false,
    boardAngle,
    inRotation: air.rot.spinAngle - air.spinStart,
    quality: landing.quality,
    failReason: null,
    sketchy: air.tailClip,
    balance: 0,
    speedKeep: air.tailClip ? cfg.featureRide.Entry.TailClipSpeedKeep : 1,
    slide: null,
    carry: 0,
    landing,
  };
  const fail = (reason: CrashReason): EntryResult => {
    result.failReason = reason;
    result.quality = 0;
    return result;
  };
  // Handle, flips, grabs: the game's landing rules (its impact rule is replaced below).
  if (landing.crash && landing.crash !== 'hardLanding') return fail(landing.crash);
  let hit = air.tailClip ? cfg.featureRide.Entry.TailClipHit : 0;

  // 1. Base flat on the surface: a hard edge held to takeoff rolls it.
  const roll = air.entry ? air.entry.roll : 0;
  if (roll > L.MaxRoll) return fail('slippedOut');
  if (roll > L.SketchyRoll) {
    result.sketchy = true;
    hit += L.RollHit;
  }
  // 2. Board angle to the axis: snap to the nearest slide (from the side, alignSlide: never a crash).
  const offAngle = Math.abs(yaw - boardAngle);
  if (aligned) hit += aligned.hit; else if (offAngle > L.SketchyAngle) return fail('badAngle');
  else if (offAngle > L.SnapTolerance) {
    result.sketchy = true;
    hit += L.AngleHit;
  }
  // 3. Across the feature: within the balance width (pipes: near the top centre).
  const off = local.v - pieceCentre(surface.piece, local.u);
  const half = balanceHalfWidth(surface.piece, s);
  if (crossSide !== 0) {
    // From the side: what it carries across keeps going (it may slide off the far side, v2 spec 3 C).
    result.carry = Math.max(0, -crossSide * dot(r.vel, rightOf(heading)));
    if (Math.abs(off) > half) {
      result.sketchy = true;
      hit += S.OvershootHit;
    }
  } else if (Math.abs(off) > half) {
    // A pipe's round top rolls the board off at once; a flat top gives a little to recover on.
    const recover = surface.piece.profile === 'Round' ? 0 : S.OvershootRecover;
    if (Math.abs(off) - half > recover) return fail('fellOffFeature');
    result.sketchy = true;
    hit += S.OvershootHit;
  }
  // 4. Impact along the surface normal.
  if (landing.impact > L.CrashImpact) return fail('hardLanding');
  if (landing.impact > L.HardImpact) hit += (L.ImpactHit * (landing.impact - L.HardImpact)) / (L.CrashImpact - L.HardImpact);
  // 5. Still spinning: the board skids.
  if (Math.abs(air.rot.spinRate) > L.SkidRate) {
    result.sketchy = true;
    hit += L.SkidHit;
  }
  result.success = true;
  if (crossSide !== 0 && isBoardslide(boardAngle)) {
    const toes = toeSign({ stance: r.stance, switchStance: air.takeoffSwitch });
    result.slide = sideEntrySlide(boardYawInAir(air), heading, crossSide, toes, air.takeoffHeading);
  }
  // The hit throws the rider toward the side they are off-centre on (or came in from).
  const dir = off !== 0 ? sign(off) : crossSide !== 0 ? crossSide : 1;
  result.balance = clamp(dir * hit, -L.MaxHit, L.MaxHit);
  if (result.sketchy) result.quality *= 0.6;
  return result;
}

/**
 * Board pitch off a safety's slope when landing on it (spec 3.5): the board
 * flies level unless flipping, the safety tilts up toward the main.
 */
export function safetyPitchError(air: AirState, slope: number): number {
  return Math.abs(atan(slope) - wrapAngle(air.rot.flipAngle));
}

/** Popped off a safety and came down on the water before reaching its main: in the gap. */
export function landedInGap(s: SimState, air: AirState): boolean {
  if (!air.pendingEntry || air.featureId === null) return false;
  const f = s.features.find((x) => x.def.id === air.featureId);
  if (!f) return false;
  const l = toLocal(f, s.rider.pos);
  let mainU0 = Infinity;
  for (const q of f.shape.pieces) if (q.slide && q.axis === 'u' && q.u0 < mainU0) mainU0 = q.u0;
  return l.u >= f.shape.uMin && l.u <= mainU0 && l.v >= f.shape.vMin && l.v <= f.shape.vMax;
}
