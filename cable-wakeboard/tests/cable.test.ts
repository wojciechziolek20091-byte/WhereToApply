import { buildCablePath, cablePointAt, createCarrier, lapsAt, stepCarrier } from '../src/sim/cable';
import { DEFAULT_CONFIG, DT, makeConfig } from '../src/sim/config';
import { distance, horizontal } from '../src/sim/math/vec';
import { wrapAngle } from '../src/sim/math/scalar';

const cfg = DEFAULT_CONFIG.cable;

describe('cable path', () => {
  const path = buildCablePath(cfg);

  it('has the perimeter minus cut corners plus arcs', () => {
    const r = cfg.cornerRadius;
    const perimeter = 2 * (240 + 110);
    expect(path.length).toBeCloseTo(perimeter - 8 * r + 2 * Math.PI * r, 6);
  });

  it('starts on the first straight heading east', () => {
    const p = cablePointAt(path, 0);
    expect(p.pos.x).toBeCloseTo(cfg.cornerRadius, 6);
    expect(p.pos.z).toBeCloseTo(0, 6);
    expect(p.pos.y).toBe(cfg.cableHeight);
    expect(p.heading).toBeCloseTo(0, 6);
  });

  it('runs counter-clockwise seen from above (turns toward -z first)', () => {
    const p = cablePointAt(path, 240);
    expect(p.pos.z).toBeLessThan(0);
    expect(wrapAngle(p.heading)).toBeLessThan(0);
  });

  it('is continuous in position and heading', () => {
    const step = 0.05;
    for (let s = 0; s < path.length; s += step) {
      const a = cablePointAt(path, s);
      const b = cablePointAt(path, s + step);
      expect(distance(a.pos, b.pos)).toBeLessThan(step * 1.0001);
      expect(Math.abs(wrapAngle(b.heading - a.heading))).toBeLessThan(step / cfg.cornerRadius + 1e-9);
    }
  });

  it('wraps around the loop', () => {
    const a = cablePointAt(path, 10);
    const b = cablePointAt(path, 10 + path.length * 3);
    expect(distance(a.pos, b.pos)).toBeCloseTo(0, 9);
  });

  it('rejects a corner radius too big for the layout', () => {
    expect(() => buildCablePath(makeConfig({ cable: { cornerRadius: 80 } }).cable)).toThrow();
  });
});

describe('carrier', () => {
  const path = buildCablePath(cfg);

  it('moves at constant speed and counts laps', () => {
    const c = createCarrier(path, 0, cfg.carrierSpeed);
    const ticks = Math.ceil(path.length / cfg.carrierSpeed / DT) + 1;
    let prev = horizontal(c.pos);
    for (let i = 0; i < ticks; i++) {
      stepCarrier(c, path, cfg.carrierSpeed, DT);
      const now = horizontal(c.pos);
      expect(distance(prev, now)).toBeLessThanOrEqual(cfg.carrierSpeed * DT + 1e-9);
      prev = now;
    }
    expect(lapsAt(path, c.s)).toBe(1);
  });
});
