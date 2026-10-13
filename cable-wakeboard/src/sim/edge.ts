import type { EdgeConfig } from './config';
import { approach, clamp, clamp01, sign, wrapAngle } from './math/scalar';

/** What edge.ts needs to know about the rider. */
export interface EdgeRider {
  stance: 'regular' | 'goofy';
  switchStance: boolean;
  edgeAngle: number;
  heading: number;
  connection: number;
}

/**
 * +1 when the rider's toes point to the right of the direction of travel.
 * Regular (left foot forward) riding forward faces right.
 */
export const toeSign = (r: Pick<EdgeRider, 'stance' | 'switchStance'>): 1 | -1 =>
  ((r.stance === 'regular' ? 1 : -1) * (r.switchStance ? -1 : 1)) as 1 | -1;

/**
 * Convert a screen-style carve request (+1 = carve to the rider's right of
 * travel) into the sim's edge request (+1 heelside, -1 toeside).
 */
export const carveToEdge = (r: Pick<EdgeRider, 'stance' | 'switchStance'>, carve: number): number =>
  -toeSign(r) * carve;

/** World side (+1 right of travel) an edge angle carves toward. */
export const carveSide = (r: EdgeRider): number => -toeSign(r) * sign(r.edgeAngle);

/** Largest edge the rider can hold right now; disconnected riders cannot hold full edge. */
export const maxHoldableEdge = (r: EdgeRider, cfg: EdgeConfig): number =>
  cfg.maxEdgeAngle * (0.6 + 0.4 * clamp01(r.connection));

/**
 * Move the edge angle toward the request. Loading is slow (edgeBuildRate),
 * flattening or switching edges is fast (edgeReleaseRate). This rate limit is
 * what makes edge load build progressively.
 */
export function updateEdge(r: EdgeRider, request: number, cfg: EdgeConfig, dt: number): void {
  const limit = maxHoldableEdge(r, cfg);
  const target = clamp(request, -1, 1) * limit;
  const loading = Math.abs(target) > Math.abs(r.edgeAngle) && sign(target) !== -sign(r.edgeAngle);
  const rate = loading ? cfg.edgeBuildRate : cfg.edgeReleaseRate;
  r.edgeAngle = clamp(approach(r.edgeAngle, target, rate * dt), -limit, limit);
}

export const edgeNorm = (r: Pick<EdgeRider, 'edgeAngle'>, cfg: EdgeConfig): number =>
  clamp01(Math.abs(r.edgeAngle) / cfg.maxEdgeAngle);

/**
 * Board heading. With the rope tight, the edge holds the board at a cut angle
 * to the rope; with the rope slack, the edge carves a turn.
 */
export function updateHeading(
  r: EdgeRider,
  ropeHeading: number,
  tension: number,
  speed: number,
  cfg: EdgeConfig,
  dt: number,
): void {
  const e = r.edgeAngle / cfg.maxEdgeAngle;
  const side = -toeSign(r);
  const target = ropeHeading + side * cfg.maxCutAngle * e;
  const ropeYaw = cfg.yawResponse * wrapAngle(target - r.heading);
  const carveYaw = side * cfg.carveCurvature * speed * e;
  const w = clamp01(tension / cfg.ropeControlTension);
  const yawRate = clamp(w * ropeYaw + (1 - w) * carveYaw, -cfg.maxYawRate, cfg.maxYawRate);
  r.heading = wrapAngle(r.heading + yawRate * dt);
}

/** Signed angle between board heading and the rope, positive to the right. */
export const cutAngle = (heading: number, ropeHeading: number): number => wrapAngle(heading - ropeHeading);
