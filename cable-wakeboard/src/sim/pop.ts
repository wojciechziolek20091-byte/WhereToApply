import type { PopConfig } from './config';
import { clamp01 } from './math/scalar';
import type { LoadTracker } from './rider';

/** Everything the pop depends on. See docs/MECHANICS.md section 4. */
export interface PopInputs {
  /** Edge load at the base of the feature, or peak load of a flat-water cut (N). */
  edgeLoadAtBase: number;
  /** Load at release / load at base. 1 = edge held all the way. */
  holdRatio: number;
  /** Rope tension when the legs extend (N). */
  tensionAtRelease: number;
  /** 0..1 how well the release lines up with the lip or peak load. */
  timing: number;
  /** 0..1 posture quality. */
  connection: number;
  /** 0..1 how far the knees were bent before extending. */
  compression: number;
}

export interface PopResult {
  /** Vertical speed added (m/s). */
  speed: number;
  /** speed / maxPop, for scoring. */
  quality: number;
}

/**
 * Energy transfer into vertical speed. Leg extension alone gives a little;
 * the edge load stored on the way in and the rope tension at release give
 * the rest. Bad timing and a disconnected posture scale everything down.
 */
export function computePop(i: PopInputs, cfg: PopConfig): PopResult {
  const legs = cfg.base * (0.4 + 0.6 * clamp01(i.compression));
  const edge = cfg.edgeGain * clamp01(i.edgeLoadAtBase / cfg.edgeLoadRef) * clamp01(i.holdRatio);
  const line = cfg.tensionGain * clamp01(i.tensionAtRelease / cfg.tensionRef);
  const posture = 0.3 + 0.7 * clamp01(i.connection);
  const speed = Math.min(cfg.maxPop, (legs + edge + line) * clamp01(i.timing) * posture);
  return { speed, quality: speed / cfg.maxPop };
}

/**
 * Kicker timing. `timeToLip` is how long until the board leaves the lip at
 * the current speed. Ideal is `lipLead`; further out the ramp absorbs the pop.
 */
export function popTimingFactor(timeToLip: number, cfg: PopConfig): number {
  const err = (timeToLip - cfg.lipLead) / cfg.lipWindow;
  return clamp01(1 - err * err);
}

/** Track the recent peak edge load for flat-water pops. */
export function updateLoadTracker(t: LoadTracker, edgeLoad: number, cfg: PopConfig, dt: number): void {
  if (edgeLoad >= t.peakEdgeLoad) {
    t.peakEdgeLoad = edgeLoad;
    t.peakAge = 0;
    return;
  }
  t.peakAge += dt;
  if (t.peakAge > cfg.peakMemory) {
    // Forget an old peak: the rider has to re-load.
    t.peakEdgeLoad = edgeLoad;
    t.peakAge = 0;
  }
}

/** Pop inputs for a flat-water release. Holding the edge to the release is what counts. */
export function flatPopInputs(
  t: LoadTracker,
  edgeLoad: number,
  tension: number,
  connection: number,
  compression: number,
  cfg: PopConfig,
): PopInputs {
  const loaded = t.peakEdgeLoad >= cfg.flatMinLoad;
  return {
    edgeLoadAtBase: loaded ? t.peakEdgeLoad : 0,
    holdRatio: t.peakEdgeLoad > 0 ? edgeLoad / t.peakEdgeLoad : 0,
    tensionAtRelease: tension,
    timing: 1,
    connection,
    compression,
  };
}
