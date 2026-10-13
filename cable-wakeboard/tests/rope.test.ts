import { DEFAULT_CONFIG } from '../src/sim/config';
import { vec3 } from '../src/sim/math/vec';
import { computeRopeTension } from '../src/sim/rope';

const cfg = DEFAULT_CONFIG.rope;
const carrier = vec3(0, 9, 0);
const still = vec3();

describe('rope', () => {
  it('is slack when shorter than its length', () => {
    const r = computeRopeTension(carrier, still, vec3(-10, 1, 0), still, 18, cfg);
    expect(r.tension).toBe(0);
    expect(r.force).toEqual(vec3());
    expect(r.stretch).toBeLessThan(0);
  });

  it('pulls toward the carrier in proportion to stretch', () => {
    const r = computeRopeTension(carrier, still, vec3(-18.1, 9, 0), still, 18, cfg);
    expect(r.tension).toBeCloseTo(cfg.stiffness * 0.1, 6);
    expect(r.force.x).toBeGreaterThan(0);
    expect(r.dir.x).toBeCloseTo(1, 9);
  });

  it('adds damping when separating and never pushes', () => {
    const away = computeRopeTension(carrier, still, vec3(-18.01, 9, 0), vec3(-1, 0, 0), 18, cfg);
    expect(away.tension).toBeCloseTo(cfg.stiffness * 0.01 + cfg.damping, 3);
    const toward = computeRopeTension(carrier, still, vec3(-18.01, 9, 0), vec3(5, 0, 0), 18, cfg);
    expect(toward.tension).toBe(0);
  });

  it('pulls upward from the elevated carrier', () => {
    const r = computeRopeTension(carrier, still, vec3(-16, 0, 0), still, 17, cfg);
    expect(r.force.y).toBeGreaterThan(0);
  });
});
