import { DEFAULT_CONFIG } from '../src/sim/config';
import { distance, horizontal, horizontalLength } from '../src/sim/math/vec';
import { createSim } from '../src/sim/world';
import { lateralOffset, run, flatSim } from './helpers';

const cfg = DEFAULT_CONFIG;

describe('riding behind the cable', () => {
  it('trails straight behind at carrier speed with a flat board', () => {
    const s = flatSim();
    run(s, 5);
    const r = s.rider;
    expect(r.mode).toBe('riding');
    expect(horizontalLength(r.vel)).toBeCloseTo(cfg.cable.carrierSpeed, 1);
    expect(Math.abs(lateralOffset(s))).toBeLessThan(0.05);
    const effective = cfg.rope.length + cfg.posture.handleInDist;
    const drop = cfg.cable.cableHeight - cfg.rider.hipHeight;
    const expected = Math.sqrt(effective ** 2 - drop ** 2);
    expect(distance(horizontal(r.pos), horizontal(s.carrier.pos))).toBeCloseTo(expected, 0);
    expect(r.ropeTension).toBeGreaterThan(150);
    expect(r.ropeTension).toBeLessThan(700);
  });

  it('swings out to the heelside, faster and with more tension, when edging', () => {
    const s = flatSim();
    run(s, 4);
    const trailTension = s.rider.ropeTension;
    let peakTension = 0;
    let peakSpeed = 0;
    run(s, 1.5, (_t, st) => {
      peakTension = Math.max(peakTension, st.rider.ropeTension);
      peakSpeed = Math.max(peakSpeed, horizontalLength(st.rider.vel));
      return { edge: 1 };
    });
    // Regular rider: toes right, so heelside is left of travel.
    expect(lateralOffset(s)).toBeLessThan(-3);
    expect(peakTension).toBeGreaterThan(trailTension * 2.5);
    expect(peakSpeed).toBeGreaterThan(cfg.cable.carrierSpeed * 1.2);
    expect(s.rider.edgeLoad).toBeGreaterThan(0);
  });

  it('goes the other way on the toeside', () => {
    const s = flatSim();
    run(s, 4);
    run(s, 1.5, () => ({ edge: -1 }));
    expect(lateralOffset(s)).toBeGreaterThan(3);
  });

  it('bleeds connection with the arms out under load', () => {
    const s = flatSim();
    run(s, 4);
    run(s, 1.5, () => ({ edge: 1, handleIn: 0 }));
    expect(s.rider.waistHinge).toBeGreaterThan(0.2);
    expect(s.rider.connection).toBeLessThan(0.5);
  });

  it('drops the handle on release and coasts to a stop', () => {
    const s = flatSim();
    run(s, 2);
    run(s, 1 / 60, () => ({ release: true }));
    expect(s.rider.hasHandle).toBe(false);
    run(s, 6);
    expect(s.rider.ropeTension).toBe(0);
    expect(horizontalLength(s.rider.vel)).toBeLessThan(3);
  });
});
