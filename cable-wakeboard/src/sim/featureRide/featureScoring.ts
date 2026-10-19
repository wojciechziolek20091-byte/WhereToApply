import type { SimConfig } from '../config';
import type { LandingResult } from '../landing';
import type { AirState, FeatureExit, RiderState } from '../rider';
import type { TrickResult, TrickToken } from '../tricks/classify';
import { POINTS, SLIDES, type SlideId } from '../tricks/data';
import { featureTrickName, type NamerOut, PRESS_SHARE } from './featureTrickNamer';

/**
 * FeatureScoring (feature riding spec 9): one TrickResult for a whole
 * feature line.
 * - Slides score per metre ridden (50-50 lowest, then boardslides,
 *   lipslides, presses); switch slides x1.1.
 * - Coverage of the feature's main of at least Scoring.FullCoverage is a
 *   "Full Feature" bonus.
 * - Rotations in, on and out score per 90 degrees (hard way x1.3, pretzel
 *   x1.2); handle passes and end taps add their points.
 * - The entry adds its bonus (side ollie-on and pop-on over ride-on).
 * - Each slide's points take its feature's difficulty multiplier.
 * - A clean water landing adds the game's clean bonus; a sketchy entry or
 *   exit cuts the quality.
 */

const token = (kind: TrickToken['kind'], name: string, points: number, extra: Partial<TrickToken> = {}): TrickToken => ({
  kind,
  name,
  degrees: null,
  direction: null,
  duration: null,
  quality: 1,
  domain: 'Feature',
  points,
  ...extra,
});

/** Fixed order (the Luau twin sums in the same order). */
const SLIDE_ORDER: SlideId[] = ['fiftyFifty', 'switchFiftyFifty', 'backboard', 'frontboard', 'backLip', 'frontLip', 'wallRide'];

const quarterTurns = (rad: number): number => Math.round(Math.abs(rad) / (Math.PI / 2));

/** The out-part of a line: spin from the board's angle on the feature, and the stance landed in. */
export function lineOut(exit: FeatureExit, air: AirState | null): NamerOut | null {
  if (!air) return null;
  const spin = air.rot.spinAngle - air.spinStart;
  const flips = Math.abs(Math.round(air.rot.spinAngle / Math.PI)) % 2 === 1;
  return { spin, landedSwitch: exit.switchStance !== flips };
}

/**
 * The line being ridden, named so far (spec 8: the in-part on landing on the
 * feature, on-feature parts as they happen, the out-part in the air), or
 * null when not on a feature line.
 */
export function liveLineName(r: RiderState): string | null {
  if (r.jib) return featureTrickName([...r.jib.chain, r.jib], null) || null;
  if (r.air && r.air.exit) return featureTrickName(r.air.exit.jibs, lineOut(r.air.exit, r.air)) || null;
  return null;
}

export function scoreFeatureLine(exit: FeatureExit, air: AirState | null, landing: LandingResult | null, cfg: SimConfig): TrickResult {
  const S = cfg.featureRide.Scoring;
  const tokens: TrickToken[] = [];
  const jibs = exit.jibs;
  const first = jibs[0]!;
  const out = lineOut(exit, air);
  const name = featureTrickName(jibs, out);

  const entryPts = S.EntryBonus[first.entry] ?? 0;
  if (entryPts > 0) tokens.push(token('Entry', first.entry, entryPts));
  let passes = air ? air.rot.passes : 0;
  let sketchy = false;
  let anySwitch = false;
  for (const j of jibs) {
    const k = j.difficulty;
    sketchy = sketchy || j.sketchy;
    // Slides per metre; a press takes its share of the 50-50 metres.
    const fiftyTime = j.slideTimes.fiftyFifty + j.slideTimes.switchFiftyFifty;
    const pressTime = Math.max(j.pressTimes.nose, j.pressTimes.tail);
    const pressShare = fiftyTime > 0 ? Math.min(1, pressTime / fiftyTime) : 0;
    for (const id of SLIDE_ORDER) {
      const m = j.slideMetres[id];
      if (m <= 0) continue;
      const sw = id === 'switchFiftyFifty' || (j.switchStance && id !== 'fiftyFifty' && id !== 'wallRide');
      anySwitch = anySwitch || sw;
      const swK = sw ? S.SwitchFactor : 1;
      if ((id === 'fiftyFifty' || id === 'switchFiftyFifty') && pressShare > PRESS_SHARE) {
        tokens.push(token('Slide', 'Press', m * pressShare * S.PerMetre.press * swK * k, { duration: pressTime }));
        tokens.push(token('Slide', SLIDES[id].name, m * (1 - pressShare) * S.PerMetre[id] * swK * k, { duration: j.slideTimes[id] }));
      } else {
        tokens.push(token('Slide', SLIDES[id].name, m * S.PerMetre[id] * swK * k, { duration: j.slideTimes[id] }));
      }
    }
    if (j.partLength > 0 && (j.uMax - j.uMin) / j.partLength >= S.FullCoverage) tokens.push(token('Bonus', 'Full Feature', S.FullFeatureBonus * k));
    const inQ = quarterTurns(j.inRotation);
    if (inQ > 0) tokens.push(token('Rotation', `${inQ * 90}-in`, inQ * S.PerQuarter * k, { degrees: inQ * 90 }));
    for (const r of j.rotations) {
      tokens.push(token('Rotation', `${r.deg}`, (r.deg / 90) * S.PerQuarter * (r.hardWay ? S.HardWayFactor : 1) * k, { degrees: r.deg, direction: r.side }));
    }
    if (j.endTap) tokens.push(token('Bonus', j.endTap === 'nose' ? 'Nose Tap' : 'Tail Tap', S.EndTapBonus * k));
    if (j.slideOnClean) tokens.push(token('Bonus', 'Clean Slide-on', S.SlideOnCleanBonus * k));
    // Air-on (side approach v2 spec 7): a side ollie-on earns its air time.
    if (j.entry === 'sideOllieOn' && j.entryAir > 0) tokens.push(token('Bonus', 'Air', cfg.slideOn.AirOnBonus * j.entryAir * k));
    passes += j.rot.passes;
  }
  if (out) {
    const q = quarterTurns(out.spin);
    if (q > 0) {
      const pretzel = quarterTurns(first.inRotation) > 0 && Math.sign(first.inRotation) !== Math.sign(out.spin);
      tokens.push(token('Rotation', `${q * 90}-out`, q * S.PerQuarter * (pretzel ? S.PretzelFactor : 1), { degrees: q * 90, direction: air ? air.rot.spinSide : null }));
    }
  }
  if (passes > 0) tokens.push(token('HandlePass', 'Handle Pass', POINTS.handlePass * passes));
  const points = tokens.reduce((a, t) => a + t.points, 0);
  const clean = !!landing && landing.clean && !sketchy && exit.kind !== 'sketchy';
  const quality = (clean ? 1 + cfg.landing.cleanBonus : 1) * (sketchy || exit.kind === 'sketchy' ? cfg.safety.sketchyMultiplier : 1);
  return {
    name,
    key: name,
    family: 'jib',
    tokens,
    points,
    quality,
    comboFactor: 1,
    difficulty: points / 250,
    spinDegrees: out ? quarterTurns(out.spin) * 90 : 0,
    spinSide: air ? air.rot.spinSide : null,
    invert: null,
    grab: null,
    switchStance: anySwitch,
  };
}
