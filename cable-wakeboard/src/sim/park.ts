import type { CablePath } from './cable';
import type { CableConfig } from './config';
import { cablePointAt } from './cable';
import { type Vec3, addScaled, horizontal, rightOf } from './math/vec';
import { WAKE_PARK } from './parkLayout';
import type { ShapeParams } from './featureCatalog';
import { buildShape, type FeatureShape, legacyShape } from './featureShapes';

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
  /** Look only: a flat box, a thin rail, or a round pipe. Physics is the same. */
  style: 'box' | 'rail' | 'tube';
  /** Length of the flat top (m). */
  length: number;
  width: number;
  height: number;
  entryLength: number;
  /** How the safety (entry ramp) meets the main: 'flush' rides on, 'gap' needs the pop. */
  safety: 'flush' | 'gap';
}

/**
 * A feature from the wake park catalogue (featureCatalog.ts), with optional
 * parameter overrides. `side` (+1 right, -1 left) puts a transfer's second box
 * or a wall ride's wall on that side of the feature's axis.
 */
export interface CatalogFeatureDef extends FeatureBase {
  kind: 'feature';
  catalog: string;
  params?: Partial<ShapeParams>;
  side?: number;
  /** Line accent colour name (FeatureConfig.Accents); looks only. */
  accent?: string;
  /** Which line of the park it belongs to ("Line 2"); signs and maps. */
  line?: string;
}

export type FeatureDef = KickerDef | SliderDef | CatalogFeatureDef;

/** A point on the ground plane (m): x east, z south. */
export interface GroundPoint {
  x: number;
  z: number;
}

/** A building or tent. `heading` turns its length (`width`) like a rider heading. */
export interface BuildingDef {
  name: string;
  x: number;
  z: number;
  /** Size along the heading (m). */
  width: number;
  /** Size across the heading (m). */
  depth: number;
  /** Wall height (m); roofs sit on top. */
  height: number;
  heading: number;
  roof: 'gable' | 'flat' | 'tent';
  color: 'white' | 'cream' | 'grey' | 'wood';
}

/** Start dock, placed along the cable like a feature. */
export interface DockDef {
  name: string;
  s: number;
  offset: number;
  length: number;
  width: number;
}

export interface AreaDef {
  kind: 'watch' | 'parking' | 'field' | 'pond';
  name: string;
  outline: GroundPoint[];
}

export interface RoadDef {
  name: string;
  width: number;
  points: GroundPoint[];
}

/**
 * Everything around the water. The sim does not collide with any of it: the
 * shoreline is drawn so the cable stays at least 12 m from land and the island
 * at least 18 m from the cable (tests/site.test.ts).
 */
export interface SiteDef {
  /** Lake shoreline, clockwise seen from above. Star-shaped about its centroid. */
  lake: GroundPoint[];
  islands: { name: string; outline: GroundPoint[]; height: number }[];
  docks: DockDef[];
  buildings: BuildingDef[];
  areas: AreaDef[];
  roads: RoadDef[];
  /** Buoy positions (the sim's and validators' view of `buoyLayout`). */
  buoys: GroundPoint[];
  /** The buoys in full (layout spec section 5): kind, diameter, what each marks. */
  buoyLayout?: { id: string; kind: 'Boundary' | 'Lane'; x: number; z: number; diameter: number; marks: string }[];
  /**
   * The cable systems standing on the site (layout spec section 2), drawn by
   * the renderers whichever park is ridden: each tower's wheel (the cable
   * corner, over the water) and its mast base on land with the arm between.
   */
  cables?: SiteCableDef[];
}

export interface SiteCableDef {
  name: string;
  mode: 'loop' | 'twoTower';
  towers: { wheel: GroundPoint; base: GroundPoint; out: GroundPoint; arm: number; apex: GroundPoint }[];
}

export interface ParkDef {
  name: string;
  features: FeatureDef[];
  /** Carrier arc length at the start of a run; the rider starts about a rope length behind. */
  startS?: number;
  /** Scenery for renderers. Optional; the sim ignores it. */
  site?: SiteDef;
  /** This park's own cable (towers, mode...), over the config's. The beginner 2-tower system uses it. */
  cable?: Partial<CableConfig>;
}

/** A feature placed in the world. */
export interface ResolvedFeature {
  def: FeatureDef;
  /** Start of the feature on the water (y = 0). */
  origin: Vec3;
  heading: number;
  /** Ride pieces in the feature's frame. */
  shape: FeatureShape;
}

/** Ride pieces of any feature def. */
export const shapeOfDef = (def: FeatureDef): FeatureShape =>
  def.kind === 'feature' ? buildShape(def.catalog, def.params, def.side ?? 1) : legacyShape(def);

/**
 * The default park: the wake park's lines (features spec) on the user's loop
 * and site (see parkLayout.ts). The user's sketch layout is LAKESIDE_PARK.
 */
export const DEFAULT_PARK: ParkDef = WAKE_PARK;

export function resolvePark(park: ParkDef, path: CablePath): ResolvedFeature[] {
  return park.features.map((def) => {
    const p = cablePointAt(path, def.s);
    const origin = addScaled(horizontal(p.pos), rightOf(p.heading), def.offset);
    return { def, origin, heading: p.heading + (def.yaw ?? 0), shape: shapeOfDef(def) };
  });
}

/** Total length of a feature along its axis. */
export const featureLength = (def: FeatureDef): number => {
  if (def.kind === 'kicker') return def.length;
  if (def.kind === 'slider') return def.entryLength + def.length;
  return shapeOfDef(def).uMax;
};

/** No features: flat water only. Used by physics tests. */
export const FLAT_PARK: ParkDef = { name: 'Flat water', features: [] };

/** Footprint width of a feature across its axis. */
export const featureWidth = (def: FeatureDef): number => {
  if (def.kind !== 'feature') return def.width;
  const sh = shapeOfDef(def);
  return sh.vMax - sh.vMin;
};
