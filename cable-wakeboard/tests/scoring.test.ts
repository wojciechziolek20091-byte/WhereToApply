import { DEFAULT_CONFIG, makeConfig } from '../src/sim/config';
import { criteriaFromMetrics, scoreRun } from '../src/sim/scoring/judges';
import type { RunMetrics } from '../src/sim/scoring/metrics';

const solid: RunMetrics = {
  trickCount: 8,
  falls: 0,
  avgLandingQuality: 0.8,
  avgPopQuality: 0.6,
  earlySpinFraction: 0,
  avgHeight: 2,
  avgAirTime: 1.2,
  topDifficulty: 3,
  uniqueTricks: 7,
  uniqueFamilies: 4,
  featureUse: 1,
  deadWater: 0,
  runTime: 160,
};

describe('judging', () => {
  it('weights 3.3 / 3.4 / 3.3 give 100 for perfect cards', () => {
    const w = DEFAULT_CONFIG.scoring.weights;
    expect(w.execution + w.intensity + w.composition).toBeCloseTo(10, 9);
  });

  it('keeps every criterion in 1..10', () => {
    const c = criteriaFromMetrics({ ...solid, falls: 9, topDifficulty: 99, avgHeight: 99 });
    for (const v of Object.values(c)) {
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(10);
    }
    expect(criteriaFromMetrics({ ...solid, trickCount: 0 })).toEqual({ execution: 1, intensity: 1, composition: 1 });
  });

  it('falls hurt execution', () => {
    expect(criteriaFromMetrics({ ...solid, falls: 1 }).execution).toBeLessThan(criteriaFromMetrics(solid).execution);
  });

  it('early spins hurt execution', () => {
    expect(criteriaFromMetrics({ ...solid, earlySpinFraction: 1 }).execution).toBeLessThan(
      criteriaFromMetrics(solid).execution,
    );
  });

  it('bigger and harder tricks raise intensity', () => {
    const big = criteriaFromMetrics({ ...solid, topDifficulty: 5, avgHeight: 3 });
    expect(big.intensity).toBeGreaterThan(criteriaFromMetrics(solid).intensity);
  });

  it('repeating one trick and dead water lower composition', () => {
    const repetitive = criteriaFromMetrics({ ...solid, uniqueTricks: 1, uniqueFamilies: 1 });
    const dead = criteriaFromMetrics({ ...solid, deadWater: 60 });
    expect(repetitive.composition).toBeLessThan(criteriaFromMetrics(solid).composition);
    expect(dead.composition).toBeLessThan(criteriaFromMetrics(solid).composition);
  });

  it('a panel is deterministic for a seed and has the configured number of judges', () => {
    const a = scoreRun(solid, DEFAULT_CONFIG.scoring);
    const b = scoreRun(solid, DEFAULT_CONFIG.scoring);
    expect(a).toEqual(b);
    expect(a.judges).toHaveLength(3);
    const c = scoreRun(solid, makeConfig({ scoring: { seed: 7 } }).scoring);
    expect(c.judges).not.toEqual(a.judges);
    for (const j of a.judges) {
      expect(Math.abs(j.execution - a.base.execution)).toBeLessThanOrEqual(DEFAULT_CONFIG.scoring.judgeBias + 0.05);
    }
  });
});
