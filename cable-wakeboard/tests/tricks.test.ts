import { createAirState } from '../src/sim/air';
import { DEFAULT_CONFIG } from '../src/sim/config';
import { neutralInput } from '../src/sim/input';
import { evaluateLanding } from '../src/sim/landing';
import { TAU } from '../src/sim/math/scalar';
import { UP, vec3 } from '../src/sim/math/vec';
import type { AirState } from '../src/sim/rider';
import { classifyAir, classifyJib } from '../src/sim/tricks/classify';
import { createRider } from '../src/sim/world';

const cfg = DEFAULT_CONFIG;
// Regular rider: frontside spins are negative yaw (-toeSign).
const FS = -1;
const BS = 1;

function trick(patch: Partial<AirState>, stance: 'regular' | 'goofy' = 'regular') {
  const r = createRider(cfg, vec3(), vec3(8, -2, 0), 0);
  const base = createAirState(r, 'kicker', 'k1', 2, 0.5, 0, neutralInput(), cfg);
  const air: AirState = { ...base, time: 1.2, ...patch };
  Object.assign(r, { mode: 'air', air });
  const landing = evaluateLanding(r, air, UP, cfg);
  expect(landing.fall).toBeNull();
  return classifyAir(air, landing, stance, cfg.air.minAirTime)!;
}

describe('jumps', () => {
  it('names backside and frontside by approach', () => {
    expect(trick({ approach: 'heelside' }).name).toBe('Backside Kicker Air');
    expect(trick({ approach: 'toeside' }).name).toBe('Frontside Kicker Air');
    expect(trick({ approach: 'heelside', source: 'flat' }).name).toBe('Backside Air Trick');
  });

  it('ignores a tiny hop', () => {
    const r = createRider(cfg, vec3(), vec3(8, -1, 0), 0);
    const air = { ...createAirState(r, 'flat', null, 1, 0.2, 0, neutralInput(), cfg), time: 0.1 };
    r.air = air;
    expect(classifyAir(air, evaluateLanding(r, air, UP, cfg), 'regular', cfg.air.minAirTime)).toBeNull();
  });
});

describe('spins', () => {
  it.each([
    [Math.PI, 180],
    [TAU, 360],
    [3 * Math.PI, 540],
  ])('counts %f rad as %i', (angle, degrees) => {
    const t = trick({ spinAngle: FS * angle, spinStarted: true, passedPeak: true });
    expect(t.spinDegrees).toBe(degrees);
    expect(t.name).toBe(`Frontside ${degrees}`);
  });

  it('rates more rotation, blind and switch as harder', () => {
    const fs180 = trick({ spinAngle: FS * Math.PI, spinStarted: true });
    const fs360 = trick({ spinAngle: FS * TAU, spinStarted: true });
    const bs180 = trick({ spinAngle: BS * Math.PI, spinStarted: true });
    // Riding switch flips which way is frontside.
    const sw180 = trick({ spinAngle: -FS * Math.PI, spinStarted: true, takeoffSwitch: true });
    expect(fs360.difficulty).toBeGreaterThan(fs180.difficulty);
    expect(bs180.name).toBe('Backside 180');
    expect(bs180.modifiers).toContain('blind');
    expect(bs180.difficulty).toBeGreaterThan(fs180.difficulty);
    expect(sw180.name).toBe('Switch Frontside 180');
    expect(sw180.difficulty).toBeGreaterThan(fs180.difficulty);
  });

  it('flips the frontside direction for goofy riders', () => {
    expect(trick({ spinAngle: -FS * Math.PI, spinStarted: true }, 'goofy').name).toBe('Frontside 180');
  });
});

describe('the six basic inverts', () => {
  it.each([
    ['heelside', -1, 'flip', 'Tantrum'],
    ['heelside', -1, 'roll', 'Heelside Backroll'],
    ['heelside', 1, 'flip', 'Heelside Frontflip'],
    ['toeside', -1, 'roll', 'Toeside Backroll'],
    ['toeside', 1, 'flip', 'Toeside Frontflip'],
    ['toeside', 1, 'roll', 'Frontroll'],
  ] as const)('%s %i %s is a %s', (approach, flipDir, axis, name) => {
    const t = trick({ approach, flipDir, axis, flipAngle: TAU });
    expect(t.family).toBe('invert');
    expect(t.name).toBe(name);
  });

  it('falls back to a generic name off the table', () => {
    expect(trick({ approach: 'heelside', flipDir: 1, axis: 'roll', flipAngle: TAU }).name).toBe('Heelside Frontroll');
  });
});

describe('combos, raleys and grabs', () => {
  it('a toeside frontroll with a frontside 180 is a scarecrow', () => {
    const t = trick({ approach: 'toeside', flipDir: 1, axis: 'roll', flipAngle: TAU, spinAngle: FS * Math.PI, spinStarted: true });
    expect(t.name).toBe('Scarecrow');
    expect(t.family).toBe('combo');
  });

  it('other invert spins are named as a combination', () => {
    const t = trick({ approach: 'heelside', flipDir: -1, axis: 'roll', flipAngle: TAU, spinAngle: FS * Math.PI, spinStarted: true });
    expect(t.name).toBe('Heelside Backroll to Frontside 180');
  });

  it('names raleys by approach', () => {
    expect(trick({ approach: 'heelside', raleyPeak: 1 }).name).toBe('Raley');
    expect(trick({ approach: 'toeside', raleyPeak: 1 }).name).toBe('Toeside Raley');
  });

  it('adds grabs to the name and difficulty', () => {
    const plain = trick({ spinAngle: FS * TAU, spinStarted: true });
    const grabbed = trick({ spinAngle: FS * TAU, spinStarted: true, grabbed: 'indy' });
    expect(grabbed.name).toBe('Frontside 360 Indy');
    expect(grabbed.difficulty).toBeGreaterThan(plain.difficulty);
    expect(grabbed.key).not.toBe(plain.key);
  });
});

describe('jibs', () => {
  it('names 50-50 and boardslide', () => {
    expect(classifyJib(1.5, 1.4, 0)!.name).toBe('50-50');
    expect(classifyJib(1.5, 0.2, 1.1)!.name).toBe('Boardslide');
    expect(classifyJib(0.1, 0.1, 0)).toBeNull();
  });
});
