import { edgeNorm, toeSign } from '../edge';
import { toLocal } from '../features';
import { DT } from '../config';
import { cos } from '../math/detmath';
import { wrapAngle } from '../math/scalar';
import { headingOf, horizontalLength } from '../math/vec';
import type { ApproachState } from '../rider';
import type { SimState } from '../world';

/**
 * ApproachTracker (feature riding spec 3.1): while the rider is on the water
 * near a feature, track how they are coming at it: distance to its start,
 * lateral offset from its centre line and gap to its nearest side, approach
 * angle, which side of the rider it is on (front, heelside, toeside), edge
 * and how long it has been held hard, speed, rope tension and direction.
 * EntryResolver reads it; the HUD's approach guide shows it.
 */
export function trackApproach(s: SimState): void {
  const { rider: r, cfg } = s;
  const A = cfg.featureRide.Approach;
  let best: { score: number; state: ApproachState } | null = null;
  const speed = horizontalLength(r.vel);
  const travel = speed > 0.5 ? headingOf(r.vel) : r.heading;
  for (const f of s.features) {
    const sh = f.shape;
    const l = toLocal(f, r.pos);
    if (l.u < sh.uMin - A.Range || l.u > sh.uMax) continue;
    const gap = l.v < sh.vMin ? sh.vMin - l.v : l.v > sh.vMax ? l.v - sh.vMax : 0;
    if (gap > A.LateralRange) continue;
    const toStart = sh.uMin - l.u;
    const score = Math.max(toStart, 0) + gap;
    if (best && score >= best.score) continue;
    const angle = wrapAngle(travel - f.heading);
    let side: ApproachState['side'] = 'front';
    if (l.v < sh.vMin - A.FrontMargin || l.v > sh.vMax + A.FrontMargin) {
      // The feature's side of the rider, in the rider's direction of travel.
      const worldSide = (l.v < sh.vMin ? 1 : -1) * (cos(angle) >= 0 ? 1 : -1);
      side = worldSide === toeSign(r) ? 'toeside' : 'heelside';
    }
    best = {
      score,
      state: {
        featureId: f.def.id,
        toStart,
        lateral: l.v - (sh.vMin + sh.vMax) / 2,
        sideGap: gap,
        angle,
        side,
        edge: edgeNorm(r, cfg.edge) * (r.edgeAngle >= 0 ? 1 : -1),
        edgeTime: 0,
        speed,
        tension: r.ropeTension,
        ropeAngle: wrapAngle(r.ropeHeading - f.heading),
      },
    };
  }
  if (!best) {
    r.approach = null;
    return;
  }
  const a = best.state;
  // The edge clock runs while the edge is hard, on the same feature.
  const prev = r.approach && r.approach.featureId === a.featureId ? r.approach.edgeTime : 0;
  a.edgeTime = Math.abs(a.edge) >= A.HardEdge ? prev + DT : 0;
  r.approach = a;
}
