import { DEFAULT_CONFIG } from '../src/sim/config';
import type { LandingResult } from '../src/sim/landing';
import type { AirState } from '../src/sim/rider';
import { createAirState } from '../src/sim/air';
import { scoreCombo } from '../src/sim/scoring/combo';
import { classifyAir } from '../src/sim/tricks/classify';
import { POINTS } from '../src/sim/tricks/data';
import { flatSim } from './helpers';

const cfg = DEFAULT_CONFIG;
const deg = (d: number) => (d * Math.PI) / 180;

/** An air state with the given rotations, as physics would leave it. */
function air(p: Partial<{ spin: number; side: 'frontside' | 'backside'; flip: number; grab: { id: 'indy' | 'stalefish' | 'nose' | 'tail'; time: number }; passes: number; trick: 'raley' | 'backroll' | 'frontroll'; sBend: number; fromBlind: boolean; source: AirState['source'] }>): AirState {
  const s = flatSim();
  const a = createAirState(s.rider, p.source ?? 'flat', null, 5, 1, cfg);
  a.time = 1;
  a.rot.spinAngle = deg(p.spin ?? 0);
  a.rot.spinSide = p.spin ? (p.side ?? 'backside') : null;
  a.rot.flipAngle = deg(p.flip ?? 0);
  a.rot.passes = p.passes ?? 0;
  if (p.grab) a.grabTimes[p.grab.id] = p.grab.time;
  a.fromBlind = !!p.fromBlind;
  if (p.trick) {
    a.trick = { kind: p.trick, sBend: p.sBend ?? 0, airtime: 1.5, u: 1, extension: 0, rollAngle: p.trick === 'raley' && !p.sBend ? 0 : Math.PI * 2, rollRate: p.trick === 'raley' && !p.sBend ? 0 : 5, timing: 1, height: 2, sBendKeyHeld: false };
  }
  return a;
}
const landing = (a: AirState, toBlind = false): LandingResult => ({
  crash: null,
  impact: 3,
  quality: 0.9,
  clean: true,
  yawError: 0,
  flipError: 0,
  halfTurns: Math.round(a.rot.spinAngle / Math.PI),
  flips: Math.round(Math.abs(a.rot.flipAngle) / (2 * Math.PI)),
  toBlind,
});
const name = (a: AirState, toBlind = false) => classifyAir(a, landing(a, toBlind), cfg)?.name;

describe('trick names (spec 11.2)', () => {
  it('spins, grabs and blind landings', () => {
    expect(name(air({ spin: 360, side: 'backside', grab: { id: 'indy', time: 0.5 }, passes: 1 }))).toBe('Backside 360 Indy');
    expect(name(air({ spin: 180, side: 'frontside' }))).toBe('Frontside 180');
    expect(name(air({ spin: 180, side: 'backside' }), true)).toBe('Backside 180 to Blind');
    expect(name(air({ spin: -180, fromBlind: true, source: 'blindPop' }))).toBe('Blind 180 Out');
  });

  it('flips, rolls, S-bends and Mobes', () => {
    expect(name(air({ flip: -360 }), true)).toBe('Tantrum to Blind');
    expect(name(air({ flip: 360, grab: { id: 'nose', time: 0.3 } }))).toBe('Front Flip Nose');
    expect(name(air({ trick: 'raley' }))).toBe('Raley');
    expect(name(air({ trick: 'raley', sBend: 1 }))).toBe('S-Bend');
    expect(name(air({ trick: 'backroll', spin: 360, grab: { id: 'stalefish', time: 0.5 } }))).toBe('Mobe Stalefish');
    expect(name(air({ trick: 'backroll', spin: 180 }))).toBe('Backroll 180');
  });

  it('plain hops and short grabs', () => {
    expect(name(air({}))).toBe('Ollie');
    expect(name(air({ grab: { id: 'tail', time: 0.1 } }))).toBe('Ollie'); // under one 0.25 s interval
  });
});

describe('points (spec 11.4)', () => {
  it('adds up the tokens', () => {
    const t = classifyAir(air({ spin: 360, side: 'backside', grab: { id: 'indy', time: 0.6 }, passes: 1 }), landing(air({})), cfg)!;
    const expected = POINTS.spinPer180 * 2 * POINTS.backsideSpinFactor + POINTS.handlePass + POINTS.grabPerInterval * 2;
    expect(t.points).toBeCloseTo(expected, 9);
    expect(t.quality).toBeCloseTo(1 + cfg.landing.cleanBonus, 9);
    const mobe = classifyAir(air({ trick: 'backroll', spin: 360 }), landing(air({})), cfg)!;
    expect(mobe.points).toBeCloseTo(450 + 300 * POINTS.backsideSpinFactor + POINTS.mobeBonus, 9);
  });

  it('combo multiplier, repeat penalty and cap', () => {
    const e = (name: string, points: number) => ({ name, points, quality: 1, comboFactor: 1 });
    expect(scoreCombo([e('A', 100)], cfg.combo).total).toBe(100);
    expect(scoreCombo([e('A', 100), e('B', 100)], cfg.combo).total).toBe(250);
    expect(scoreCombo([e('A', 100), e('A', 100)], cfg.combo).total).toBe(Math.round(150 * 1.25));
    const many = Array.from({ length: 20 }, (_, i) => e(`T${i}`, 10));
    expect(scoreCombo(many, cfg.combo).multiplier).toBe(cfg.combo.maxMultiplier);
    expect(scoreCombo([{ ...e('A', 100), comboFactor: 0.8 }], cfg.combo).total).toBe(80);
  });
});
