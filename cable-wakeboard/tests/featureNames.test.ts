import { describe, expect, it } from 'vitest';
import { featureTrickName } from '../src/sim/featureRide/featureTrickNamer';
import type { SlideId } from '../src/sim/tricks/data';
import { deg, MORE_NAMES, type NameCase, SPEC_EXAMPLES, ZERO } from './parity/namerCases';

describe('FeatureTrickNamer: the spec 8 examples, exactly', () => {
  it.each<NameCase>(SPEC_EXAMPLES)('%s: %s', (_what, jibs, o, name) => {
    expect(featureTrickName(jibs, o)).toBe(name);
  });
});

describe('FeatureTrickNamer: more lines', () => {
  it.each<NameCase>(MORE_NAMES)('%s: %s', (_what, jibs, o, name) => {
    expect(featureTrickName(jibs, o)).toBe(name);
  });
});

import { scoreFeatureLine } from '../src/sim/featureRide/featureScoring';
import { DEFAULT_CONFIG } from '../src/sim/config';
import type { AirState, FeatureExit, JibState } from '../src/sim/rider';
import type { LandingResult } from '../src/sim/landing';

/** A JibState with only what scoring reads. */
function slideJib(o: Partial<JibState> & { metres?: Partial<Record<SlideId, number>> }): JibState {
  const slideMetres = { ...ZERO, ...(o.metres ?? {}) };
  const slideTimes = { ...ZERO };
  for (const k of Object.keys(slideMetres) as SlideId[]) slideTimes[k] = slideMetres[k] / 8;
  return {
    entry: 'rideOn',
    inRotation: 0,
    slideOrder: (Object.keys(slideMetres) as SlideId[]).filter((k) => slideMetres[k] > 0),
    slideTimes,
    pressTimes: { nose: 0, tail: 0 },
    switchStance: false,
    rotations: [],
    slideMetres,
    uMin: 3,
    uMax: 9,
    partLength: 8,
    difficulty: 1,
    sketchy: false,
    endTap: null,
    rot: { passes: 0 },
    chain: [],
    ...o,
  } as unknown as JibState;
}
const exitOf = (jibs: JibState[], kind: FeatureExit['kind'] = 'popOff'): FeatureExit => ({ kind, jibs, boardAngle: 0, switchStance: false });
const airSpin = (spinDeg: number, startDeg = 0) => ({ rot: { spinAngle: deg(startDeg + spinDeg), passes: 0, spinSide: null }, spinStart: deg(startDeg), time: 0.8, peakHeight: 1 }) as unknown as AirState;
const landed = (clean: boolean) => ({ clean, quality: 0.9 }) as LandingResult;
const tokenPts = (r: ReturnType<typeof scoreFeatureLine>, name: string) => r.tokens.filter((t) => t.name === name).reduce((a, t) => a + t.points, 0);
const S = DEFAULT_CONFIG.featureRide.Scoring;

describe('FeatureScoring (feature ride M9, spec 9)', () => {
  it('slides score per metre: 50-50 < boardslide < lipslide < press', () => {
    const per = (id: SlideId) => tokenPts(scoreFeatureLine(exitOf([slideJib({ metres: { [id]: 6 }, uMax: 4 })]), null, null, DEFAULT_CONFIG), SLIDES_NAME[id]!);
    expect(per('fiftyFifty')).toBeLessThan(per('backboard'));
    expect(per('backboard')).toBeLessThan(per('backLip'));
    const press = scoreFeatureLine(exitOf([slideJib({ metres: { fiftyFifty: 6 }, pressTimes: { nose: 0.75, tail: 0 }, uMax: 4 })]), null, null, DEFAULT_CONFIG);
    expect(tokenPts(press, 'Press') / (6 * 1)).toBeCloseTo(S.PerMetre.press, 9);
  });

  it('coverage: 90% of the main or more is a Full Feature bonus', () => {
    expect(tokenPts(scoreFeatureLine(exitOf([slideJib({ metres: { fiftyFifty: 8 }, uMin: 3, uMax: 10.3 })]), null, null, DEFAULT_CONFIG), 'Full Feature')).toBe(S.FullFeatureBonus);
    expect(tokenPts(scoreFeatureLine(exitOf([slideJib({ metres: { fiftyFifty: 6 }, uMin: 3, uMax: 9 })]), null, null, DEFAULT_CONFIG), 'Full Feature')).toBe(0);
  });

  it('rotations per 90; hard way x1.3, pretzel x1.2, switch x1.1', () => {
    const rot = (hardWay: boolean) =>
      scoreFeatureLine(exitOf([slideJib({ metres: { fiftyFifty: 4 }, rotations: [{ deg: 180, dir: 1, side: 'backside', hardWay, from: 'frontboard', endTick: 1, to: 'backboard', atTime: 0 }] })]), null, null, DEFAULT_CONFIG);
    expect(tokenPts(rot(false), '180')).toBe(2 * S.PerQuarter);
    expect(tokenPts(rot(true), '180')).toBeCloseTo(2 * S.PerQuarter * 1.3, 9);
    const inJib = slideJib({ entry: 'pop', inRotation: deg(270), metres: { backboard: 4 } });
    const same = scoreFeatureLine(exitOf([inJib]), airSpin(270, 90), landed(true), DEFAULT_CONFIG);
    const pretzel = scoreFeatureLine(exitOf([inJib]), airSpin(-270, 90), landed(true), DEFAULT_CONFIG);
    expect(pretzel.name).toBe('270-in Backside Boardslide 270-out Pretzel');
    expect(tokenPts(pretzel, '270-out')).toBeCloseTo(tokenPts(same, '270-out') * 1.2, 9);
    const sw = scoreFeatureLine(exitOf([slideJib({ metres: { switchFiftyFifty: 6 }, uMax: 4 })]), null, null, DEFAULT_CONFIG);
    expect(tokenPts(sw, 'Switch 50-50')).toBeCloseTo(6 * S.PerMetre.switchFiftyFifty * 1.1, 9);
  });

  it('entry bonus: pop-on and side ollie-on over ride-on; difficulty scales the slide points', () => {
    const entry = (e: JibState['entry']) => tokenPts(scoreFeatureLine(exitOf([slideJib({ entry: e, metres: { fiftyFifty: 4 } })]), null, null, DEFAULT_CONFIG), e);
    expect(entry('popOn')).toBeGreaterThan(entry('rideOn'));
    expect(entry('sideOllieOn')).toBeGreaterThan(entry('rideOn'));
    const easy = scoreFeatureLine(exitOf([slideJib({ metres: { fiftyFifty: 4 }, difficulty: 1 })]), null, null, DEFAULT_CONFIG).points;
    const hard = scoreFeatureLine(exitOf([slideJib({ metres: { fiftyFifty: 4 }, difficulty: 1.45 })]), null, null, DEFAULT_CONFIG).points;
    expect(hard / easy).toBeCloseTo(1.45, 9);
  });

  it('a clean landing adds the clean bonus; a sketchy entry or exit cuts the quality', () => {
    const q = (sketchy: boolean, kind: FeatureExit['kind'] = 'popOff') => scoreFeatureLine(exitOf([slideJib({ metres: { fiftyFifty: 4 }, sketchy })], kind), airSpin(0), landed(true), DEFAULT_CONFIG).quality;
    expect(q(false)).toBeCloseTo(1 + DEFAULT_CONFIG.landing.cleanBonus, 9);
    expect(q(true)).toBeCloseTo(DEFAULT_CONFIG.safety.sketchyMultiplier, 9);
    expect(q(false, 'sketchy')).toBeCloseTo(DEFAULT_CONFIG.safety.sketchyMultiplier, 9);
  });
});

const SLIDES_NAME: Partial<Record<SlideId, string>> = { fiftyFifty: '50-50', backboard: 'Backside Boardslide', backLip: 'Backside Lipslide' };
