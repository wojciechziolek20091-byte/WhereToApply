import { type Vec3, addScaled, dot, forwardOf, normalize, rightOf, sub, UP, vec3 } from './math/vec';
import type { FeatureDef, KickerDef, ResolvedFeature, SliderDef } from './park';
import { featureLength } from './park';

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
  /** Unit tangent up the surface along the axis. */
  tangent: Vec3;
  /** On the flat top of a slider (not the entry ramp). */
  onTop: boolean;
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
export const kickerExponent = (k: KickerDef): number => Math.max(1, (Math.tan(k.lipAngle) * k.length) / k.height);

export function kickerHeightAt(k: KickerDef, u: number): { height: number; slope: number } {
  const x = Math.min(Math.max(u / k.length, 0), 1);
  const p = kickerExponent(k);
  return { height: k.height * x ** p, slope: ((k.height * p) / k.length) * x ** (p - 1) };
}

export function sliderHeightAt(sd: SliderDef, u: number): { height: number; slope: number; onTop: boolean } {
  if (u < sd.entryLength) {
    const slope = sd.height / sd.entryLength;
    return { height: Math.max(0, u) * slope, slope, onTop: false };
  }
  return { height: sd.height, slope: 0, onTop: true };
}

export const insideFootprint = (def: FeatureDef, l: FeatureLocal, margin = 0): boolean =>
  l.u >= -margin && l.u <= featureLength(def) + margin && Math.abs(l.v) <= def.width / 2 + margin;

/** Surface under a local point, or null outside the footprint. */
export function surfaceAt(f: ResolvedFeature, l: FeatureLocal): FeatureSurface | null {
  if (!insideFootprint(f.def, l)) return null;
  const hs = f.def.kind === 'kicker' ? { ...kickerHeightAt(f.def, l.u), onTop: false } : sliderHeightAt(f.def, l.u);
  const fwd = forwardOf(f.heading);
  const tangent = normalize(addScaled(fwd, UP, hs.slope));
  const normal = normalize(addScaled(UP, fwd, -hs.slope));
  return { height: hs.height, slope: hs.slope, normal, tangent, onTop: hs.onTop };
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
