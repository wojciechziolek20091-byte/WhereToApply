import type { PostureConfig } from './config';
import { approach, clamp01, lerp } from './math/scalar';

export interface PostureRider {
  handleDist: number;
  waistHinge: number;
  connection: number;
  legCompression: number;
  hasHandle: boolean;
}

/** 0 with the handle at the hips, 1 with arms fully out. */
export const handleNorm = (r: Pick<PostureRider, 'handleDist'>, cfg: PostureConfig): number =>
  clamp01((r.handleDist - cfg.handleInDist) / (cfg.handleOutDist - cfg.handleInDist));

/** 0..1: how well the rider's posture transmits rope load. */
export function connectionFactor(r: PostureRider, cfg: PostureConfig): number {
  if (!r.hasHandle) return 0;
  return clamp01(1 - cfg.handleWeight * handleNorm(r, cfg) - cfg.hingeWeight * r.waistHinge);
}

/**
 * Handle drifts toward the requested position. Holding the arms out under
 * tension pulls the rider over at the waist; keeping the handle in lets the
 * rider stand back up. Holding `load` bends the knees.
 */
export function updatePosture(
  r: PostureRider,
  handleIn: number,
  loadHeld: boolean,
  tension: number,
  cfg: PostureConfig,
  dt: number,
): void {
  const target = lerp(cfg.handleOutDist, cfg.handleInDist, clamp01(handleIn));
  r.handleDist = approach(r.handleDist, target, cfg.handleRate * dt);
  const out = handleNorm(r, cfg);
  const pull = tension / cfg.hingeTensionRef;
  const dHinge = cfg.hingeGain * pull * out - cfg.hingeRecovery * (1 - out);
  r.waistHinge = clamp01(r.waistHinge + dHinge * dt);
  r.legCompression = loadHeld
    ? approach(r.legCompression, 1, cfg.compressRate * dt)
    : approach(r.legCompression, 0, cfg.standRate * dt);
  r.connection = connectionFactor(r, cfg);
}
