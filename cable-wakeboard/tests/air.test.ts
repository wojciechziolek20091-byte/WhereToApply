import { DEFAULT_CONFIG, makeConfig } from '../src/sim/config';
import type { SimEvent } from '../src/sim/events';
import { neutralInput, type InputFrame } from '../src/sim/input';
import { FLAT_PARK } from '../src/sim/park';
import { carryTarget, rotationSide } from '../src/sim/rotation';
import { stepSim } from '../src/sim/step';
import { createSim, type SimState } from '../src/sim/world';
import { flatSim, run, runUntil, untilTouchdown } from './helpers';

const cfg = DEFAULT_CONFIG;
type Script = (t: number, s: SimState) => Partial<InputFrame>;

/** Cruise, charge for `hold` s, release, then play `air` until touchdown. */
function ollie(hold: number, air: Script = () => ({}), s: SimState = flatSim()): { s: SimState; e: SimEvent } {
  run(s, 3);
  run(s, hold, () => ({ pop: true }));
  return { s, e: untilTouchdown(s, air) };
}

describe('ollie, air and landing (milestone 3)', () => {
  it('charge sets the pop: a tap gives minV, half a second gives maxV', () => {
    const tap = ollie(1 / 60);
    const full = ollie(0.6);
    if (tap.e.type !== 'landed' || full.e.type !== 'landed') throw new Error('expected landings');
    expect(tap.e.air.popSpeed).toBeCloseTo(cfg.ollie.minV + (cfg.ollie.maxV - cfg.ollie.minV) * 0, 1);
    expect(full.e.air.popSpeed).toBeCloseTo(cfg.ollie.maxV, 6);
    expect(full.e.air.peakHeight).toBeGreaterThan(tap.e.air.peakHeight * 2);
    expect(full.e.landing.clean).toBe(true);
  });

  it('lands into the short grace state, then rides on', () => {
    const { s } = ollie(0.3);
    expect(s.rider.mode).toBe('landing');
    run(s, cfg.landing.graceTime + 0.05);
    expect(s.rider.mode).toBe('riding');
  });

  it('crashes and respawns behind the carrier after the delay', () => {
    const s = createSim(makeConfig({}), FLAT_PARK, 125);
    run(s, 2);
    run(s, 1 / 60, () => ({ letGo: true }));
    expect(s.rider.mode).toBe('crashed');
    run(s, cfg.crash.respawnDelay + 0.05);
    expect(s.rider.crashTimer).toBe(0);
  });
});

describe('rotation tracker and handle system (milestone 4)', () => {
  it('a released spin carries to the next half turn only within maxCarry', () => {
    expect(carryTarget(2.0, 1, Math.PI, cfg.spin.maxCarry)).toBeCloseTo(Math.PI, 9);
    expect(carryTarget(1.0, 1, Math.PI, cfg.spin.maxCarry)).toBe(1.0);
    expect(carryTarget(-2.0, -1, Math.PI, cfg.spin.maxCarry)).toBeCloseTo(-Math.PI, 9);
  });

  it('frontside is the chest turning to the pull first', () => {
    // Regular, heading east (0) with the rope ahead: chest faces south (+z). Turning
    // counter-clockwise (A) brings the chest round to the rope: frontside.
    expect(rotationSide(-1, 0, 1, 0)).toBe('frontside');
    expect(rotationSide(1, 0, 1, 0)).toBe('backside');
  });

  it('a short tap spin carries round to a clean 180', () => {
    const { e } = ollie(0.6, (t) => ({ steer: t < 0.25 ? -1 : 0 }));
    if (e.type !== 'landed') throw new Error(`crashed: ${e.type === 'crash' ? e.reason : ''}`);
    expect(Math.abs(e.landing.halfTurns)).toBe(1);
    expect(e.air.rot.spinSide).toBe('frontside');
  });

  it('backside past 90 with no pass: the rope stops it at 180 with the handle behind (to blind)', () => {
    const { s, e } = ollie(0.6, () => ({ steer: 1 }));
    if (e.type !== 'landed') throw new Error('expected a landing');
    expect(e.air.rot.spinSide).toBe('backside');
    expect(e.landing.halfTurns).toBe(1);
    expect(e.landing.toBlind).toBe(true);
    run(s, 0.2);
    expect(s.rider.mode).toBe('ridingBlind');
  });

  it('Q in the window passes the handle and the backside 360 lands', () => {
    const { e } = ollie(0.6, (t) => ({ steer: t < 0.62 ? 1 : 0, pass: t > 0.2 && t < 0.25 }));
    if (e.type !== 'landed') throw new Error('expected a landing');
    expect(e.air.rot.passes).toBe(1);
    expect(e.landing.halfTurns).toBe(2);
    expect(e.landing.toBlind).toBe(false);
  });

  it('Q at the wrong time drops the handle: crash on landing', () => {
    const { e } = ollie(0.6, (t) => ({ steer: t < 0.62 ? 1 : 0, pass: t > 0.05 && t < 0.1 }));
    expect(e).toMatchObject({ type: 'crash', reason: 'handleDropped' });
  });

  it('frontside: the first 180 needs no pass; a 360 needs one in 180-270', () => {
    const noPass = ollie(0.6, () => ({ steer: -1 })).e;
    if (noPass.type !== 'landed') throw new Error('expected a landing');
    expect(noPass.landing.halfTurns).toBe(-1); // pulled back to the 180
    const pass = ollie(0.6, (t) => ({ steer: t < 0.62 ? -1 : 0, pass: t > 0.36 && t < 0.4 })).e;
    if (pass.type !== 'landed') throw new Error('expected a landing');
    expect(pass.landing.halfTurns).toBe(-2);
  });

  it('flips turn about the board: held long enough they land, short they under-rotate', () => {
    const front = ollie(0.6, (t) => ({ forward: t < 0.85 })).e;
    if (front.type !== 'landed') throw new Error('expected a landing');
    expect(front.landing.flips).toBe(1);
    expect(front.air.rot.flipAngle).toBeGreaterThan(0);
    const tantrum = ollie(0.6, (t) => ({ back: t < 0.85 })).e;
    if (tantrum.type !== 'landed') throw new Error('expected a landing');
    expect(tantrum.air.rot.flipAngle).toBeLessThan(0);
    expect(ollie(0.6, (t) => ({ back: t < 0.5 })).e).toMatchObject({ type: 'crash', reason: 'underRotated' });
  });
});

describe('riding blind', () => {
  const toBlind = (): SimState => {
    const { s } = ollie(0.6, () => ({ steer: 1 }));
    run(s, 0.2);
    expect(s.rider.mode).toBe('ridingBlind');
    return s;
  };

  it('spins out back the way it came (A after a D spin) to ride normally again', () => {
    const s = toBlind();
    const stanceBlind = s.rider.switchStance;
    run(s, 0.05, () => ({ steer: -1 }));
    run(s, 0.5);
    expect(s.rider.mode).toBe('riding');
    expect(s.rider.handle).toBe('inFront');
    expect(s.rider.switchStance).toBe(!stanceBlind);
  });

  it('the other direction catches an edge; so does staying blind too long', () => {
    const s = toBlind();
    run(s, 0.05, () => ({ steer: 1 }));
    expect(s.rider.lastCrash).toBe('caughtEdgeBlind');
    const t = toBlind();
    run(t, cfg.blind.maxRideTime + 0.1);
    expect(t.rider.lastCrash).toBe('caughtEdgeBlind');
  });

  it('caps tension while blind', () => {
    const s = toBlind();
    let peak = 0;
    run(s, 1, (_t, st) => {
      peak = Math.max(peak, st.rider.ropeTension);
      return {};
    });
    expect(peak).toBeLessThanOrEqual(cfg.blind.maxTension);
  });

  it('pop from blind and spin out in the air: handle back in front, normal stance', () => {
    const s = toBlind();
    run(s, 0.4, () => ({ pop: true }));
    const e = untilTouchdown(s, (t) => ({ steer: t < 0.3 ? -1 : 0 }));
    if (e.type !== 'landed') throw new Error(`crashed: ${e.type === 'crash' ? e.reason : ''}`);
    expect(e.air.fromBlind).toBe(true);
    expect(s.rider.handle).toBe('inFront');
    expect(e.landing.toBlind).toBe(false);
  });
});

describe('grabs (milestone 5)', () => {
  it('E alone is an indy, E + R a stalefish; letting go before landing is required', () => {
    const indy = ollie(0.6, (t) => ({ grab: t > 0.1 && t < 0.8 })).e;
    if (indy.type !== 'landed') throw new Error('expected a landing');
    expect(indy.air.grabTimes.indy).toBeGreaterThan(0.5);
    const stale = ollie(0.6, (t) => ({ grab: t > 0.1 && t < 0.8, grabMod: t > 0.12 && t < 0.8 ? 'stalefish' : null })).e;
    if (stale.type !== 'landed') throw new Error('expected a landing');
    expect(stale.air.grabTimes.stalefish).toBeGreaterThan(0.5);
    expect(stale.air.grabTimes.indy).toBe(0);
    expect(ollie(0.6, () => ({ grab: true })).e).toMatchObject({ type: 'crash', reason: 'grabHeldOnLanding' });
  });

  it('can be switched to a sketchy landing instead of a crash', () => {
    const s = createSim(makeConfig({ landing: { grabHeldCrashes: false } }), FLAT_PARK, 125);
    const e = ollie(0.6, () => ({ grab: true }), s).e;
    expect(e.type).toBe('landed');
  });
});

describe('determinism of the new input path', () => {
  it('replays bit-identically', () => {
    const play = () => {
      const s = flatSim();
      for (let i = 0; i < 900; i++) stepSim(s, { ...neutralInput(), steer: i % 200 < 90 ? -1 : 1, pop: i % 150 > 120, pass: i % 97 === 0 });
      return JSON.stringify(s.rider);
    };
    expect(play()).toBe(play());
    void runUntil;
  });
});
