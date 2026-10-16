import { atan2, pow, tan } from './math/detmath';
import { type Vec3, addScaled, dot, forwardOf, normalize, rightOf, scale, sub, UP, vec3 } from './math/vec';
import type { KickerDef, ResolvedFeature, SliderDef } from './park';
import { type RidePiece, pieceCentre, shapeSurfaceAt } from './featureShapes';

/** Position in a feature's frame: u along its axis, v to its right. */
export interface FeatureLocal {
  u: number;
  v: number;
}

export interface FeatureSurface {
  height: number;
  /** dh/du. */
  slope: number;
  /** Unit normal of the riding surface. */
  normal: Vec3;
  /** Unit tangent up the surface along the piece. */
  tangent: Vec3;
  /** On a slideable piece (a main or exit ramp), not an entry ramp. */
  onTop: boolean;
  /** The ride piece under the point. */
  piece: RidePiece;
  /** dh/d(distance across) on walls and pyramid side faces. */
  crossSlope: number;
}

export const toLocal = (f: ResolvedFeature, pos: Vec3): FeatureLocal => {
  const d = sub(pos, f.origin);
  return { u: dot(d, forwardOf(f.heading)), v: dot(d, rightOf(f.heading)) };
};

export const toWorld = (f: ResolvedFeature, u: number, v: number, y: number): Vec3 => {
  const p = addScaled(addScaled(f.origin, forwardOf(f.heading), u), rightOf(f.heading), v);
  return vec3(p.x, y, p.z);
};

/** Kicker exponent so the slope at the lip equals tan(lipAngle). */
export const kickerExponent = (k: KickerDef): number => Math.max(1, (tan(k.lipAngle) * k.length) / k.height);

/** The old kicker formula; the sim now rides `featureShapes` pieces, which give the same numbers. */
export function kickerHeightAt(k: KickerDef, u: number): { height: number; slope: number } {
  const x = Math.min(Math.max(u / k.length, 0), 1);
  const p = kickerExponent(k);
  return { height: k.height * pow(x, p), slope: ((k.height * p) / k.length) * pow(x, p - 1) };
}

/** The old slider formula (see kickerHeightAt). */
export function sliderHeightAt(sd: SliderDef, u: number): { height: number; slope: number; onTop: boolean } {
  if (u < sd.entryLength) {
    const slope = sd.height / sd.entryLength;
    return { height: Math.max(0, u) * slope, slope, onTop: false };
  }
  return { height: sd.height, slope: 0, onTop: true };
}

/** Heading of a piece's centre line (splayed boxes turn off the feature's axis). */
export const pieceHeading = (f: ResolvedFeature, p: RidePiece): number =>
  p.v1 === p.v0 ? f.heading : f.heading + atan2(p.v1 - p.v0, p.u1 - p.u0);

/** Distance across a piece from its centre line. */
export const offCentre = (p: RidePiece, l: FeatureLocal): number => l.v - pieceCentre(p, l.u);

/** Surface under a local point, or null off every ride piece. */
export function surfaceAt(f: ResolvedFeature, l: FeatureLocal): FeatureSurface | null {
  const s = shapeSurfaceAt(f.shape, l.u, l.v);
  if (!s) return null;
  const p = s.piece;
  const fwd = forwardOf(f.heading);
  const right = rightOf(f.heading);
  if (s.crossSlope !== 0 || p.wall) {
    // Walls and pyramid side faces: the local normal (x along, z across) in the world.
    const normal = normalize(addScaled(addScaled(scale(UP, s.normal.y), fwd, s.normal.x), right, s.normal.z));
    return { height: s.height, slope: 0, normal, tangent: fwd, onTop: p.slide, piece: p, crossSlope: s.crossSlope };
  }
  const k = (p.v1 - p.v0) / (p.u1 - p.u0);
  const along = addScaled(fwd, right, k);
  const tangent = normalize(addScaled(along, UP, s.slope));
  const normal = normalize(addScaled(UP, fwd, -s.slope));
  return { height: s.height, slope: s.slope, normal, tangent, onTop: p.slide, piece: p, crossSlope: 0 };
}

/** Highest feature surface under a world position, if any. */
export function featureUnder(
  features: ResolvedFeature[],
  pos: Vec3,
): { feature: ResolvedFeature; local: FeatureLocal; surface: FeatureSurface } | null {
  let best: ReturnType<typeof featureUnder> = null;
  for (const feature of features) {
    const local = toLocal(feature, pos);
    const surface = surfaceAt(feature, local);
    if (surface && (!best || surface.height > best.surface.height)) best = { feature, local, surface };
  }
  return best;
}
