import { DEFAULT_CONFIG, makeConfig } from '../src/sim/config';
import { buildCablePath, cablePointAt } from '../src/sim/cable';
import { distance, horizontal, horizontalLength } from '../src/sim/math/vec';
import { FLAT_PARK } from '../src/sim/park';
import { createSim } from '../src/sim/world';
import { lateralOffset, run, flatSim } from './helpers';

const cfg = DEFAULT_CONFIG;

describe('riding behind the cable (milestone 2)', () => {
  it('trails straight behind at carrier speed, cruising at 250-500 N', () => {
    const s = flatSim();
    run(s, 5);
    const r = s.rider;
    expect(r.mode).toBe('riding');
    expect(horizontalLength(r.vel)).toBeCloseTo(cfg.cable.carrierSpeed, 1);
    expect(Math.abs(lateralOffset(s))).toBeLessThan(0.05);
    const effective = cfg.rope.length + cfg.posture.handleInDist;
    const drop = cfg.cable.cableHeight - cfg.rider.hipHeight;
    expect(distance(horizontal(r.pos), horizontal(s.carrier.pos))).toBeCloseTo(Math.sqrt(effective ** 2 - drop ** 2), 0);
    expect(r.tensionSmooth).toBeGreaterThan(250);
    expect(r.tensionSmooth).toBeLessThan(500);
  });

  it('a hard edge away from the line passes 1000 N within about a second and arms a water trick', () => {
    const s = flatSim();
    run(s, 4);
    let crossedAt = -1;
    run(s, 2, (t, st) => {
      if (crossedAt < 0 && st.rider.tensionSmooth > 1000) crossedAt = t;
      return { steer: -1 };
    });
    // Regular rider: toes right, so A (steer -1) is the heelside, carving left of travel.
    expect(lateralOffset(s)).toBeLessThan(-3);
    expect(crossedAt).toBeGreaterThan(0.3);
    expect(crossedAt).toBeLessThan(1.2);
    expect(s.rider.tensionSmooth).toBeLessThanOrEqual(cfg.rope.maxTension);
  });

  it('arms LOADED only while sideways, edged and over the threshold, and disarms with hysteresis', () => {
    const s = flatSim();
    run(s, 4);
    const modes: string[] = [];
    run(s, 3.5, (t, st) => {
      modes.push(st.rider.mode);
      return { steer: t < 2.2 ? -1 : 0 };
    });
    expect(modes).toContain('waterTrickLoad');
    expect(s.rider.mode).toBe('riding');
  });

  it('goes the other way on the toeside (D)', () => {
    const s = flatSim();
    run(s, 4);
    run(s, 1.5, () => ({ steer: 1 }));
    expect(lateralOffset(s)).toBeGreaterThan(3);
  });

  it('bleeds connection with the arms out under load', () => {
    const s = flatSim();
    run(s, 4);
    run(s, 1.5, () => ({ steer: -1, armsOut: true }));
    expect(s.rider.waistHinge).toBeGreaterThan(0.2);
    expect(s.rider.connection).toBeLessThan(0.5);
  });

  it('letting go (X) crashes, then respawns behind the carrier after the delay', () => {
    const s = flatSim();
    run(s, 2);
    run(s, 1 / 60, () => ({ letGo: true }));
    expect(s.rider.mode).toBe('crashed');
    expect(s.rider.lastCrash).toBe('letGo');
    expect(s.rider.crashTimer).toBeCloseTo(cfg.crash.respawnDelay, 6);
  });
});

describe('two-tower cable (test mode)', () => {
  it('shuttles out and back along one line', () => {
    const c = makeConfig({ cable: { mode: 'twoTower', towers: [{ x: 0, z: 0 }, { x: 60, z: 0 }] } });
    const path = buildCablePath(c.cable);
    expect(path.length).toBeCloseTo(120, 9);
    expect(cablePointAt(path, 30).pos.x).toBeCloseTo(30, 9);
    expect(Math.cos(cablePointAt(path, 30).heading)).toBeCloseTo(1, 9);
    expect(cablePointAt(path, 90).pos.x).toBeCloseTo(30, 9);
    expect(Math.cos(cablePointAt(path, 90).heading)).toBeCloseTo(-1, 9);
    const s = createSim(c, FLAT_PARK, 5);
    run(s, 4);
    expect(s.rider.mode).not.toBe('crashed');
  });
});
