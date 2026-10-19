import type { SimConfig } from '../config';
import type { LandingResult } from '../landing';
import { airSpin } from '../landing';
import type { AirState, JibState, RotationSide } from '../rider';
import { GRABS, type GrabId, INVERTS, type InvertId, POINTS, SLIDES } from './data';

/**
 * Names and points for what physics reported (spec section 11). One air or
 * one slide is one trick; the session chains tricks into combos.
 */

export type TrickFamily = 'jump' | 'spin' | 'invert' | 'raley' | 'jib';

/** Building blocks of a trick, kept for the HUD feed and server validation. */
export interface TrickToken {
  kind: 'Entry' | 'Slide' | 'Spin' | 'Flip' | 'Invert' | 'Grab' | 'HandlePass' | 'Blind' | 'Exit' | 'Pop' | 'Rotation' | 'Bonus';
  name: string;
  degrees: number | null;
  direction: RotationSide | null;
  duration: number | null;
  /** 0..1 timing quality. */
  quality: number;
  domain: 'Water' | 'Air' | 'Feature';
  points: number;
}

export interface TrickResult {
  /** Display name, also the key for the repeat rule. */
  name: string;
  key: string;
  family: TrickFamily;
  tokens: TrickToken[];
  /** Base points (before the clean-landing bonus and combo multiplier). */
  points: number;
  /** Points multiplier from landing quality (clean landing: 1 + landing.cleanBonus). */
  quality: number;
  /** Combo multiplier from this trick (sketchy pop-on: safety.sketchyMultiplier), else 1. */
  comboFactor: number;
  /** For the judges: points on their difficulty scale. */
  difficulty: number;
  spinDegrees: number;
  spinSide: RotationSide | null;
  invert: InvertId | null;
  grab: GrabId | null;
  switchStance: boolean;
}

const token = (
  kind: TrickToken['kind'],
  name: string,
  points: number,
  domain: TrickToken['domain'],
  extra: Partial<Pick<TrickToken, 'degrees' | 'direction' | 'duration' | 'quality'>> = {},
): TrickToken => ({
  kind,
  name,
  degrees: extra.degrees ?? null,
  direction: extra.direction ?? null,
  duration: extra.duration ?? null,
  quality: extra.quality ?? 1,
  domain,
  points,
});

/** The grab held longest this air, if held for at least one scoring interval. */
function bestGrab(air: AirState): { id: GrabId; time: number } | null {
  let best: { id: GrabId; time: number } | null = null;
  for (const id of ['indy', 'stalefish', 'nose', 'tail'] as GrabId[]) {
    const t = air.grabTimes[id];
    if (t >= POINTS.grabInterval && (!best || t > best.time)) best = { id, time: t };
  }
  return best;
}

const capitalise = (side: RotationSide): string => (side === 'frontside' ? 'Frontside' : 'Backside');

/**
 * Name and score one air (spec 11.2: [Entry] [Invert] [Spin] [Grab] [to Blind]).
 * Returns null for a hop too small to count.
 */
export function classifyAir(air: AirState, landing: LandingResult, cfg: SimConfig): TrickResult | null {
  const tokens: TrickToken[] = [];
  const domain: TrickToken['domain'] = air.trick ? 'Water' : 'Air';
  const fromFeature = air.source === 'feature';
  const spin = airSpin(air);
  // Feature exits count quarter turns ("270 Off"); everything else half turns.
  const step = fromFeature ? Math.PI / 2 : Math.PI;
  const degrees = Math.abs(Math.round(spin / step)) * (fromFeature ? 90 : 180);
  const side = air.rot.spinSide;

  let invert: InvertId | null = null;
  if (air.trick) invert = air.trick.sBend !== 0 ? 'sBend' : air.trick.kind;
  else if (landing.flips > 0) invert = air.rot.flipAngle > 0 ? 'frontFlip' : 'tantrum';
  const invertDef = invert ? INVERTS[invert] : null;
  const flips = air.trick ? 1 : landing.flips;

  if (invertDef) {
    tokens.push(token(invertDef.invert ? 'Invert' : 'Pop', invertDef.name, invertDef.points * flips, domain, { quality: air.popQuality }));
  }
  if (degrees > 0) {
    const sideFactor = side === 'backside' ? POINTS.backsideSpinFactor : 1;
    tokens.push(token('Spin', `${degrees}`, POINTS.spinPer180 * (degrees / 180) * sideFactor, domain, { degrees, direction: side }));
  }
  if (air.rot.passes > 0) tokens.push(token('HandlePass', 'Handle Pass', POINTS.handlePass * air.rot.passes, domain));
  const grab = bestGrab(air);
  if (grab) {
    const intervals = Math.min(POINTS.grabMaxIntervals, Math.floor(grab.time / POINTS.grabInterval));
    tokens.push(token('Grab', GRABS[grab.id].name, POINTS.grabPerInterval * intervals, domain, { duration: grab.time }));
  }
  if (landing.toBlind) tokens.push(token('Blind', 'to Blind', POINTS.toBlind, domain));
  const blindOut = air.fromBlind && degrees > 0 && !landing.toBlind;
  if (blindOut) tokens.push(token('Exit', 'Blind Out', POINTS.blindOut, domain));

  const mobe = !!invertDef && invertDef.invert && degrees >= 360;
  if (mobe) tokens.push(token('Invert', 'Mobe', POINTS.mobeBonus, domain));

  // Name.
  let name = '';
  if (mobe) name = degrees > 360 ? `Mobe ${degrees}` : 'Mobe';
  else if (invertDef) {
    name = `${flips > 1 ? 'Double ' : ''}${invertDef.name}${degrees > 0 ? ` ${degrees}` : ''}`;
  } else if (degrees > 0) {
    if (blindOut) name = `Blind ${degrees} Out`;
    else if (fromFeature) name = `${degrees} Off`;
    else name = `${side ? capitalise(side) : ''} ${degrees}`.trim();
  }
  if (grab) name = name ? `${name} ${GRABS[grab.id].name}` : GRABS[grab.id].name;
  if (landing.toBlind) name = `${name || (side ? capitalise(side) : '')} to Blind`.trim();

  if (!name) {
    // A plain ollie or kicker air, if it was a real jump.
    if (air.time < cfg.air.minAirTime) return null;
    if (air.source === 'flat' || air.source === 'blindPop') name = 'Ollie';
    else if (air.source === 'kicker') name = air.lipPop ? 'Kicker Air Pop' : 'Kicker Air';
    else return null;
    tokens.push(token('Pop', name, POINTS.ollie, domain, { quality: air.popQuality }));
  }
  // Over a feature from its side (side approach v2): "Ollie Over", "Frontside 360 Over".
  if (air.over) {
    name = `${name} Over`;
    tokens.push(token('Bonus', 'Over', POINTS.overBonus, domain));
    // A brief touch on the top on the way over (v2 spec 3 D).
    if (air.tap) tokens.push(token('Bonus', 'Tap', POINTS.tapBonus, domain));
  }

  const points = tokens.reduce((a, t) => a + t.points, 0);
  const family: TrickFamily = invertDef ? (invertDef.invert ? 'invert' : 'raley') : degrees > 0 ? 'spin' : 'jump';
  return {
    name,
    key: name,
    family,
    tokens,
    points,
    quality: landing.clean ? 1 + cfg.landing.cleanBonus : 1,
    // DECISION alternative to crashing: a grab held on touchdown halves the combo multiplier.
    comboFactor: air.grab && !cfg.landing.grabHeldCrashes ? 0.5 : 1,
    difficulty: points / 250,
    spinDegrees: degrees,
    spinSide: side,
    invert,
    grab: grab ? grab.id : null,
    switchStance: air.takeoffSwitch,
  };
}

/** Name and score one slide on a box or rail ("Pop-on Backboard to Frontboard"). Null if too short. */
export function classifySlide(jib: JibState, cfg: SimConfig): TrickResult | null {
  if (jib.time < 0.3) return null;
  const tokens: TrickToken[] = [];
  if (jib.entry === 'popOn') tokens.push(token('Entry', 'Pop-on', POINTS.popOn, 'Feature'));
  const slides = jib.slideOrder.filter((id) => jib.slideTimes[id] >= 0.15);
  for (const id of slides) {
    const def = SLIDES[id];
    tokens.push(token('Slide', def.name, def.pointsPerSecond * jib.slideTimes[id], 'Feature', { duration: jib.slideTimes[id] }));
  }
  const quarter = Math.round(jib.rot.maxSpin / (Math.PI / 2));
  const degrees = quarter * 90;
  if (degrees >= 180) {
    const sideFactor = jib.rot.spinSide === 'backside' ? POINTS.backsideSpinFactor : 1;
    tokens.push(token('Spin', `${degrees} on`, POINTS.spinPer180 * (degrees / 180) * sideFactor, 'Feature', { degrees, direction: jib.rot.spinSide }));
  }
  if (jib.rot.passes > 0) tokens.push(token('HandlePass', 'Handle Pass', POINTS.handlePass * jib.rot.passes, 'Feature'));
  if (slides.length === 0) return null;
  const slideNames = slides.map((id) => SLIDES[id].name).join(' to ');
  const name = `${jib.entry === 'popOn' ? 'Pop-on ' : ''}${slideNames}`;
  const points = tokens.reduce((a, t) => a + t.points, 0);
  return {
    name,
    key: name,
    family: 'jib',
    tokens,
    points,
    quality: 1,
    comboFactor: jib.sketchy ? cfg.safety.sketchyMultiplier : 1,
    difficulty: points / 250,
    spinDegrees: degrees,
    spinSide: jib.rot.spinSide,
    invert: null,
    grab: null,
    switchStance: slides.includes('switchFiftyFifty'),
  };
}
