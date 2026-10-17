import type { FeatureLocal } from '../features';
import { pieceHeightAt, type RidePiece } from '../featureShapes';
import { atan2 } from '../math/detmath';
import { dot, forwardOf, rightOf } from '../math/vec';
import type { ResolvedFeature } from '../park';
import type { ApproachState } from '../rider';
import type { SimState } from '../world';
import { maxReachableHeight, type SideType } from './slideOnConfig';
import { partEnd } from './slideController';

/**
 * Slide-on (side approaches spec): side entries lift the nose over the side
 * edge of a feature's top and slide the base on. This part reads the
 * approach (spec 3): the turn-in, the inward speed, where the board will
 * meet the edge, what kind of edge it is and whether a slide-on is possible.
 */

/** Why a slide-on is not available ('' when it is). */
export type SlideOnBlock = '' | 'front' | 'range' | 'angle' | 'distance' | 'noTop' | 'wall' | 'height' | 'end';

/**
 * Side edge type of a feature's top (derived from the ride data unless the
 * feature def sets `sideType`): round profiles are Round (pipes), narrow
 * flat tops thin rails, a pyramid's top is surrounded by banks, wall
 * pieces are walls; any other flat top has the validator's rounded edge.
 */
export function sideTypeOf(f: ResolvedFeature, p: RidePiece, s: SimState): SideType {
  if (f.def.sideType) return f.def.sideType;
  if (p.wall) return 'Wall';
  if (p.profile === 'Round') return 'Round';
  if (f.shape.pieces.some((q) => q.cap !== null)) return 'Bank';
  if (p.width < s.cfg.slideOn.RailMaxWidth) return 'Rail';
  return 'Rounded';
}

/** The slide piece of a feature's top under `u` (along its axis), if any. */
export function topPieceAt(f: ResolvedFeature, u: number): RidePiece | null {
  for (const p of f.shape.pieces) if (p.slide && p.axis === 'u' && !p.wall && u >= p.u0 && u <= p.u1) return p;
  return null;
}

/**
 * Fill the slide-on fields of an approach (spec 3): `l` is the board's
 * position in the feature frame, `toStart` and `sideGap` as the tracker
 * measured them.
 */
export function assessSlideOn(s: SimState, f: ResolvedFeature, l: FeatureLocal, a: ApproachState): void {
  const { rider: r, cfg } = s;
  const S = cfg.slideOn;
  const sh = f.shape;
  const along = dot(r.vel, forwardOf(f.heading));
  const across = dot(r.vel, rightOf(f.heading));
  // Toward the feature: +v from its left side, -v from its right.
  const toward = l.v < sh.vMin ? 1 : l.v > sh.vMax ? -1 : 0;
  const inward = across * toward;
  a.inwardSpeed = inward;
  a.turnIn = toward === 0 ? 0 : atan2(inward, Math.abs(along));
  // Where the board meets the edge, carrying on as it goes.
  a.contactU = toward !== 0 && inward > 0.05 ? l.u + (along * a.sideGap) / inward : l.u;
  const p = topPieceAt(f, a.contactU);
  a.topHeight = p ? pieceHeightAt(p, a.contactU).height : 0;
  a.sideType = p ? sideTypeOf(f, p, s) : 'Rounded';
  a.edgeRadius = p ? p.radius : 0;
  a.remaining = p ? partEnd(f, p.part) - a.contactU : 0;
  a.maxHeight = maxReachableHeight(cfg, 1, S.MaxNoseLift, a.sideType, a.speed, Math.max(a.turnIn, S.MinAngle));
  a.slideOnBlock =
    toward === 0
      ? 'front'
      : a.toStart > S.TrackRange
        ? 'range'
        : a.turnIn < S.MinAngle || a.turnIn > S.MaxAngle
          ? 'angle'
          : a.sideGap < S.MinLateral || a.sideGap > S.MaxLateral
            ? 'distance'
            : !p
              ? 'noTop'
              : a.sideType === 'Wall' || (f.def.sideWall ?? 0) > S.WallBlock
                ? 'wall'
                : a.topHeight > a.maxHeight
                  ? 'height'
                  : a.remaining < S.MinRemaining
                    ? 'end'
                    : '';
}
