import { DEFAULT_CONFIG } from '../src/sim/config';
import { computePop, popTimingFactor, updateLoadTracker, type PopInputs } from '../src/sim/pop';
import { cutAndPop, untilTouchdown, flatSim } from './helpers';

const cfg = DEFAULT_CONFIG.pop;
const good: PopInputs = {
  edgeLoadAtBase: 1500,
  holdRatio: 1,
  tensionAtRelease: 1500,
  timing: 1,
  connection: 1,
  compression: 1,
};

describe('computePop', () => {
  it('grows with edge load and tension', () => {
    const low = computePop({ ...good, edgeLoadAtBase: 300, tensionAtRelease: 300 }, cfg).speed;
    const mid = computePop({ ...good, edgeLoadAtBase: 900, tensionAtRelease: 300 }, cfg).speed;
    const high = computePop({ ...good, edgeLoadAtBase: 900, tensionAtRelease: 1200 }, cfg).speed;
    expect(mid).toBeGreaterThan(low);
    expect(high).toBeGreaterThan(mid);
  });

  it('is killed by backing off the edge, bad timing and bad posture', () => {
    const full = computePop(good, cfg).speed;
    expect(computePop({ ...good, holdRatio: 0.3 }, cfg).speed).toBeLessThan(full);
    expect(computePop({ ...good, timing: 0 }, cfg).speed).toBe(0);
    expect(computePop({ ...good, connection: 0.2 }, cfg).speed).toBeLessThan(full * 0.6);
  });

  it('is capped', () => {
    const r = computePop({ ...good, edgeLoadAtBase: 1e6, tensionAtRelease: 1e6 }, cfg);
    expect(r.speed).toBe(cfg.maxPop);
    expect(r.quality).toBe(1);
  });
});

describe('kicker timing', () => {
  it('peaks just before the lip and vanishes outside the window', () => {
    expect(popTimingFactor(cfg.lipLead, cfg)).toBe(1);
    expect(popTimingFactor(cfg.lipLead + cfg.lipWindow * 0.5, cfg)).toBeCloseTo(0.75, 9);
    expect(popTimingFactor(cfg.lipLead + cfg.lipWindow * 1.1, cfg)).toBe(0);
  });
});

describe('load tracker', () => {
  it('remembers a peak, then forgets it', () => {
    const t = { edgeLoadAtBase: 0, peakEdgeLoad: 0, peakAge: 0 };
    updateLoadTracker(t, 1000, cfg, 0.1);
    updateLoadTracker(t, 400, cfg, 0.1);
    expect(t.peakEdgeLoad).toBe(1000);
    for (let i = 0; i < 10; i++) updateLoadTracker(t, 400, cfg, 0.1);
    expect(t.peakEdgeLoad).toBe(400);
  });
});

describe('flat-water air trick', () => {
  const airOf = (opts: Parameters<typeof cutAndPop>[1]) => {
    const s = flatSim();
    const takeoff = cutAndPop(s, opts);
    const land = untilTouchdown(s);
    if (land.type !== 'landed') throw new Error(`fell: ${land.type === 'fall' ? land.kind : ''}`);
    return { pop: takeoff?.type === 'takeoff' ? takeoff.popSpeed : 0, air: land.air.time, peak: land.air.peakHeight };
  };

  it('a loaded, held edge pops higher than flattening early or releasing in the slack', () => {
    const held = airOf({ releaseAt: 2.2 });
    const flattened = airOf({ releaseAt: 2.2, flattenAt: 1.9 });
    const slack = airOf({ releaseAt: 0.8 });
    expect(held.pop).toBeGreaterThan(flattened.pop);
    expect(held.pop).toBeGreaterThan(slack.pop);
    expect(held.air).toBeGreaterThan(1);
    expect(held.peak).toBeGreaterThan(0.8);
  });
});
