import type { FallKind } from '../rider';
import type { TrickResult } from '../tricks/classify';

/** One trick landed during a run. */
export interface TrickRecord {
  tick: number;
  pass: number;
  trick: TrickResult;
  airTime: number;
  /** Peak board height above the water (m). */
  height: number;
  /** Horizontal distance from takeoff to landing (m). */
  distance: number;
  /** 0..1 from evaluateLanding(). */
  landingQuality: number;
  /** 0..1 from computePop(). */
  popQuality: number;
  spunBeforePeak: boolean;
  featureId: string | null;
}

export interface FallRecord {
  tick: number;
  pass: number;
  kind: FallKind;
}

/** Aggregates the judges look at. */
export interface RunMetrics {
  trickCount: number;
  falls: number;
  avgLandingQuality: number;
  avgPopQuality: number;
  earlySpinFraction: number;
  avgHeight: number;
  avgAirTime: number;
  /** Mean difficulty of the best five tricks. */
  topDifficulty: number;
  uniqueTricks: number;
  uniqueFamilies: number;
  /** Fraction of the park's features used. */
  featureUse: number;
  /** Seconds of dead water beyond the allowance. */
  deadWater: number;
  runTime: number;
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function computeRunMetrics(
  tricks: TrickRecord[],
  falls: FallRecord[],
  featureCount: number,
  deadWater: number,
  runTime: number,
): RunMetrics {
  const airs = tricks.filter((t) => t.trick.family !== 'jib');
  const best = [...tricks].map((t) => t.trick.difficulty).sort((a, b) => b - a).slice(0, 5);
  const featuresUsed = new Set(tricks.map((t) => t.featureId).filter((f): f is string => f !== null));
  return {
    trickCount: tricks.length,
    falls: falls.length,
    avgLandingQuality: mean(tricks.map((t) => t.landingQuality)),
    avgPopQuality: mean(airs.map((t) => t.popQuality)),
    earlySpinFraction: airs.length ? airs.filter((t) => t.spunBeforePeak).length / airs.length : 0,
    avgHeight: mean(airs.map((t) => t.height)),
    avgAirTime: mean(airs.map((t) => t.airTime)),
    topDifficulty: mean(best),
    uniqueTricks: new Set(tricks.map((t) => t.trick.key)).size,
    uniqueFamilies: new Set(tricks.map((t) => t.trick.family)).size,
    featureUse: featureCount ? featuresUsed.size / featureCount : 1,
    deadWater,
    runTime,
  };
}
