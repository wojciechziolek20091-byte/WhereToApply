import type { ScoringConfig } from '../config';
import { clamp, clamp01 } from '../math/scalar';
import { createRng, nextRange } from '../math/rng';
import type { RunMetrics } from './metrics';

export interface CriteriaScores {
  execution: number;
  intensity: number;
  composition: number;
}

export interface JudgeCard extends CriteriaScores {
  total: number;
}

export interface RunScore {
  /** Panel consensus before judge bias. */
  base: CriteriaScores;
  judges: JudgeCard[];
  /** Mean of the judges' totals, out of 100 with the default weights. */
  total: number;
}

const toScale = (x: number): number => clamp(1 + 9 * clamp01(x), 1, 10);

/**
 * Execution: clean landings, completed tricks, good pops, no falls.
 * Intensity: size (height, air time) and difficulty.
 * Composition: variety, use of the park, flow without dead water.
 */
export function criteriaFromMetrics(m: RunMetrics): CriteriaScores {
  if (m.trickCount === 0) return { execution: 1, intensity: 1, composition: 1 };
  const exec = 0.7 * m.avgLandingQuality + 0.3 * m.avgPopQuality - 0.15 * m.sketchyFraction;
  const execution = clamp(toScale(exec) - 2.5 * m.falls, 1, 10);
  const intensity = toScale(0.55 * (m.topDifficulty / 6) + 0.3 * (m.avgHeight / 4) + 0.15 * (m.avgAirTime / 2));
  const variety = Math.min(1, m.uniqueTricks / 6) * (m.uniqueTricks / m.trickCount);
  const flow = m.runTime > 0 ? 1 - Math.min(1, (2 * m.deadWater) / m.runTime) : 0;
  const composition = toScale(0.4 * variety + 0.25 * Math.min(1, m.uniqueFamilies / 5) + 0.2 * m.featureUse + 0.15 * flow);
  return { execution, intensity, composition };
}

const round1 = (x: number): number => Math.round(x * 10) / 10;

/** A panel of judges, each with a small deterministic bias per criterion. */
export function scoreRun(m: RunMetrics, cfg: ScoringConfig): RunScore {
  const base = criteriaFromMetrics(m);
  const rng = createRng(cfg.seed);
  const judges: JudgeCard[] = [];
  for (let j = 0; j < cfg.judges; j++) {
    const card = {
      execution: round1(clamp(base.execution + nextRange(rng, -cfg.judgeBias, cfg.judgeBias), 1, 10)),
      intensity: round1(clamp(base.intensity + nextRange(rng, -cfg.judgeBias, cfg.judgeBias), 1, 10)),
      composition: round1(clamp(base.composition + nextRange(rng, -cfg.judgeBias, cfg.judgeBias), 1, 10)),
    };
    const w = cfg.weights;
    const total = card.execution * w.execution + card.intensity * w.intensity + card.composition * w.composition;
    judges.push({ ...card, total: round1(total) });
  }
  const total = round1(judges.reduce((a, j) => a + j.total, 0) / Math.max(1, judges.length));
  return { base, judges, total };
}
