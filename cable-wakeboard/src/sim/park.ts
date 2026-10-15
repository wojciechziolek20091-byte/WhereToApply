import type { CablePath } from './cable';
import { cablePointAt } from './cable';
import { type Vec3, addScaled, horizontal, rightOf } from './math/vec';

/**
 * Features are placed relative to the cable: `s` is the arc length along the
 * cable where the feature starts, `offset` is sideways from the cable line
 * (+ right of travel). Each feature points along the cable at `s`.
 */
interface FeatureBase {
  id: string;
  name: string;
  s: number;
  offset: number;
  /** Extra yaw relative to the cable heading (rad). */
  yaw?: number;
}

/** Curved ramp. Height follows a power curve whose slope at the lip is lipAngle. */
export interface KickerDef extends FeatureBase {
  kind: 'kicker';
  length: number;
  width: number;
  height: number;
  lipAngle: number;
}

/** Flat-topped box or rail, entered by a straight entry ramp from the water. */
export interface SliderDef extends FeatureBase {
  kind: 'slider';
  style: 'box' | 'rail';
  /** Length of the flat top (m). */
  length: number;
  width: number;
  height: number;
  entryLength: number;
}

export type FeatureDef = KickerDef | SliderDef;

export interface ParkDef {
  name: string;
  features: FeatureDef[];
}

/** A feature placed in the world. */
export interface ResolvedFeature {
  def: FeatureDef;
  /** Start of the feature on the water (y = 0). */
  origin: Vec3;
  heading: number;
}

export const DEFAULT_PARK: ParkDef = {
  name: 'Gray-box park',
  features: [
    { kind: 'kicker', id: 'k1', name: 'Kicker 1', s: 75, offset: 0, length: 4.5, width: 3.5, height: 1.1, lipAngle: 0.5 },
    {
      kind: 'slider',
      id: 'b1',
      name: 'Fun box',
      style: 'box',
      s: 150,
      offset: 0,
      length: 10,
      width: 0.6,
      height: 0.5,
      entryLength: 3,
    },
    // Off-line features: carve out to reach them.
    { kind: 'kicker', id: 'k3', name: 'Side kicker', s: 112, offset: -9, length: 3.8, width: 3, height: 0.9, lipAngle: 0.45 },
    {
      kind: 'slider',
      id: 'b2',
      name: 'Wide box',
      style: 'box',
      s: 190,
      offset: 8,
      length: 8,
      width: 1.0,
      height: 0.4,
      entryLength: 2.5,
    },
    {
      kind: 'slider',
      id: 'b3',
      name: 'Low box',
      style: 'box',
      s: 372,
      offset: -8,
      length: 7,
      width: 0.8,
      height: 0.35,
      entryLength: 2.5,
    },
    { kind: 'kicker', id: 'k2', name: 'Kicker 2', s: 410, offset: 0, length: 5.5, width: 4, height: 1.6, lipAngle: 0.6 },
    {
      kind: 'slider',
      id: 'r1',
      name: 'Rail',
      style: 'rail',
      s: 490,
      offset: 0,
      length: 8,
      width: 0.12,
      height: 0.6,
      entryLength: 3,
    },
    { kind: 'kicker', id: 'k4', name: 'Hip kicker', s: 455, offset: 9, length: 4.2, width: 3.2, height: 1.2, lipAngle: 0.55 },
    {
      kind: 'slider',
      id: 'r2',
      name: 'Long rail',
      style: 'rail',
      s: 532,
      offset: -7,
      length: 10,
      width: 0.12,
      height: 0.5,
      entryLength: 3,
    },
  ],
};

export function resolvePark(park: ParkDef, path: CablePath): ResolvedFeature[] {
  return park.features.map((def) => {
    const p = cablePointAt(path, def.s);
    const origin = addScaled(horizontal(p.pos), rightOf(p.heading), def.offset);
    return { def, origin, heading: p.heading + (def.yaw ?? 0) };
  });
}

/** Total length of a feature along its axis. */
export const featureLength = (def: FeatureDef): number =>
  def.kind === 'kicker' ? def.length : def.entryLength + def.length;

/** No features: flat water only. Used by physics tests. */
export const FLAT_PARK: ParkDef = { name: 'Flat water', features: [] };
