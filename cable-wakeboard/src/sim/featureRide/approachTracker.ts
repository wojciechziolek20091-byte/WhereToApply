import { edgeNorm, toeSign } from '../edge';
import { type FeatureLocal, toLocal } from '../features';
import type { ResolvedFeature } from '../park';
import { assessSlideOn } from './slideOn';
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
/** edgeAge on an approach that never had a hard edge (s). */
const NEVER = 99;

export function trackApproach(s: SimState): void {
  const { rider: r, cfg } = s;
  const A = cfg.featureRide.Approach;
  let best: { score: number; state: ApproachState; f: ResolvedFeature; l: FeatureLocal } | null = null;
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
    let featureSide = 0;
    // Alongside it (past the start, outside its width) is a side approach however close.
    if (l.v < sh.vMin - A.FrontMargin || l.v > sh.vMax + A.FrontMargin || (toStart < 0 && gap > 0)) {
      // The feature's side of the rider, in the rider's direction of travel.
      featureSide = (l.v < sh.vMin ? 1 : -1) * (cos(angle) >= 0 ? 1 : -1);
      side = featureSide === toeSign(r) ? 'toeside' : 'heelside';
    }
    best = {
      score,
      f,
      l,
      state: {
        featureId: f.def.id,
        toStart,
        lateral: l.v - (sh.vMin + sh.vMax) / 2,
        sideGap: gap,
        angle,
        side,
        edge: edgeNorm(r, cfg.edge) * (r.edgeAngle >= 0 ? 1 : -1),
        edgeTime: 0,
        edgeAge: 0,
        featureSide,
        inwardSpeed: 0,
        turnIn: 0,
        contactU: 0,
        topHeight: 0,
        sideType: 'Rounded',
        edgeRadius: 0,
        remaining: 0,
        maxHeight: 0,
        slideOnBlock: 'front',
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
  const same = r.approach && r.approach.featureId === a.featureId ? r.approach : null;
  const hard = Math.abs(a.edge) >= A.HardEdge;
  a.edgeTime = hard ? (same ? same.edgeTime : 0) + DT : 0;
  a.edgeAge = hard ? 0 : (same ? same.edgeAge : NEVER) + DT;
  // Can the board slide on from here (side approaches spec 3)?
  assessSlideOn(s, best.f, best.l, a);
  r.approach = a;
}
