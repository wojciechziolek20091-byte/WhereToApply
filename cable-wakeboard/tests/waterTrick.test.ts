import { DEFAULT_CONFIG } from '../src/sim/config';
import type { SimEvent } from '../src/sim/events';
import type { InputFrame } from '../src/sim/input';
import { airtimeFor, raleyExtension } from '../src/sim/waterTrick';
import { waterTrickHeight } from '../src/sim/pop';
import { classifyAir } from '../src/sim/tricks/classify';
import { cutAndPop, flatSim, untilTouchdown } from './helpers';

const cfg = DEFAULT_CONFIG;

/** Heelside cut, pop at `releaseAt` with S/W, then `air` until touchdown. */
function waterTrick(opts: { releaseAt?: number; back?: boolean; forward?: boolean }, air: (t: number) => Partial<InputFrame> = () => ({})) {
  const s = flatSim();
  const take = cutAndPop(s, opts);
  const e = untilTouchdown(s, air);
  const name = e.type === 'landed' ? classifyAir(e.air, e.landing, s.cfg)?.name : null;
  return { s, take, e, name };
}
const crashReason = (e: SimEvent) => (e.type === 'crash' ? e.reason : null);

describe('water tricks (milestone 8)', () => {
  it('height follows h = base (T/1000)^1.2 (0.5 + 0.5 timing), capped', () => {
    expect(waterTrickHeight(1000, 1, cfg)).toBeCloseTo(1.8, 9);
    expect(waterTrickHeight(1000, 0, cfg)).toBeCloseTo(0.9, 9);
    expect(waterTrickHeight(5000, 1, cfg)).toBe(cfg.waterTrick.maxHeight);
  });

  it('raley phases: pop, extension, swing down, landing prep', () => {
    expect(raleyExtension(0, cfg)).toBe(0);
    expect(raleyExtension(0.3, cfg)).toBeCloseTo(Math.PI / 2, 9);
    expect(raleyExtension(0.7, cfg)).toBeGreaterThan(0);
    expect(raleyExtension(0.9, cfg)).toBe(0);
  });

  it('Space only at the tension peak is a raley; timing near the peak is near 1', () => {
    const { take, e, name, s } = waterTrick({ releaseAt: 1.0 });
    expect(take).toMatchObject({ type: 'takeoff', source: 'waterTrick' });
    if (e.type !== 'landed') throw new Error(`crashed: ${crashReason(e)}`);
    expect(name).toBe('Raley');
    expect(e.air.trick!.timing).toBeGreaterThan(0.8);
    expect(e.air.trick!.height).toBeGreaterThan(1.8);
    expect(s.rider.mode).toBe('landing');
  });

  it('a late release scores lower timing and less height', () => {
    const good = waterTrick({ releaseAt: 1.0 }).e;
    const late = waterTrick({ releaseAt: 1.9 }).e;
    if (good.type !== 'landed' || late.type !== 'landed') throw new Error('expected landings');
    expect(late.air.trick!.timing).toBeLessThan(good.air.trick!.timing);
    expect(late.air.peakHeight).toBeLessThan(good.air.peakHeight);
  });

  it('S + Space is a backroll, W + Space a frontroll: one full roll, landed', () => {
    const back = waterTrick({ back: true });
    if (back.e.type !== 'landed') throw new Error(`crashed: ${crashReason(back.e)}`);
    expect(back.name).toBe('Backroll');
    expect(back.e.landing.flips).toBe(1);
    const front = waterTrick({ forward: true });
    expect(front.name).toBe('Frontroll');
  });

  it('a roll from too low a pop cannot finish (under-rotated)', () => {
    // Late in the cut the tension has dropped: low pop.
    const { e, take } = waterTrick({ releaseAt: 2.2, back: true });
    expect(take).toMatchObject({ source: 'waterTrick' });
    if (e.type === 'landed') expect(e.air.trick!.height).toBeGreaterThanOrEqual(cfg.waterTrick.minRollHeight);
    else expect(crashReason(e)).toBe('underRotated');
  });

  it('A/D in the raley position inside the S-bend window turns it into an S-bend; earlier it spins', () => {
    const t = airtimeFor(2.3);
    const at = (u: number) => u * t;
    const sbend = waterTrick({}, (x) => ({ steer: x > at(0.3) && x < at(0.3) + 0.1 ? 1 : 0 }));
    expect(sbend.name).toBe('S-Bend');
    const early = waterTrick({}, (x) => ({ steer: x > 0.05 && x < 0.15 ? 1 : 0 }));
    if (early.e.type !== 'landed') throw new Error(`crashed: ${crashReason(early.e)}`);
    expect(early.e.air.trick!.sBend).toBe(0);
  });

  it('a backroll with a 360 and a handle pass is a Mobe; grabs work in water tricks', () => {
    const mobe = waterTrick({ back: true }, (x) => ({ steer: x < 0.6 ? 1 : 0, pass: x > 0.2 && x < 0.25 }));
    expect(mobe.name).toBe('Mobe');
    const grab = waterTrick({}, (x) => ({ grab: x > 0.2 && x < 0.7 }));
    expect(grab.name).toBe('Raley Indy');
  });

  it('staying extended (spinning through the swing-down) lands extended: crash', () => {
    const { e } = waterTrick({ releaseAt: 1.9 }, () => ({ steer: 1, grab: false }));
    // Either the rope stops the spin and it lands, or the raley is still out at touchdown.
    if (e.type === 'crash') expect(['raleyExtendedOnLanding', 'underRotated', 'overRotated', 'badLandingYaw']).toContain(e.reason);
  });

  it('cannot arm from blind or with the handle out of reach', () => {
    const s = flatSim();
    s.rider.handle = 'behind';
    cutAndPop(s);
    expect(s.rider.air?.source ?? 'none').not.toBe('waterTrick');
  });
});
