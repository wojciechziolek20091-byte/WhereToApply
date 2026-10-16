/**
 * Cable towers (layout spec section 2): low-poly grey steel masts on land,
 * each with a concrete foundation, a boom out to the carrier wheel over the
 * cable corner, a tie from the mast top to the boom tip, and three guy wires
 * back to ground anchors. Engine-free part list; the web renderer turns it
 * into hulls, roblox/src/shared/Park/TowerBuilder.luau (its twin, checked by
 * tests/tower.test.ts) into parts. Colours come from FeatureConfig.Style by
 * role (Tower, GuyWire, Foundation).
 */
import type { GroundPoint } from '../sim/park';

export type V3 = [number, number, number];

export interface TowerPart {
  name: string;
  /** box: `a` centre, `b` half extents. beam: `a` to `b`, square section of half-width `r`. disc: `a` centre, vertical axis, radius `r`, `b[1]` half thickness. */
  kind: 'box' | 'beam' | 'disc';
  a: V3;
  b: V3;
  r: number;
  role: 'Tower' | 'GuyWire' | 'Foundation';
}

export interface TowerSiteLike {
  wheel: GroundPoint;
  /** Where the cable passes: the boom and wheel reach here. */
  apex: GroundPoint;
  base: GroundPoint;
  out: GroundPoint;
  arm: number;
}

/** Dimensions (m). */
export const TOWER = {
  foundationHalf: 1.5,
  foundationTop: 0.5,
  foundationDepth: 0.3,
  mastHalf: 0.3,
  /** Mast top above the cable, plus this much per metre of arm (a taller mast for a longer boom). */
  mastAbove: 1.2,
  mastPerArm: 0.12,
  boomHalf: 0.18,
  tieHalf: 0.05,
  wheelRadius: 1.0,
  wheelHalfThickness: 0.12,
  wireHalf: 0.03,
  anchorHalf: 0.3,
  /** Guy wire anchors: this far from the base per metre of mast, at these angles from the back-stay. */
  wireReach: 0.6,
  wireAngles: [-40, 0, 40],
};

/** One tower's parts. `cableHeight`: cable above the water (m); `ground`: land height at the base (m). */
export function towerParts(t: TowerSiteLike, cableHeight: number, ground: number): TowerPart[] {
  const T = TOWER;
  const top = cableHeight + T.mastAbove + T.mastPerArm * t.arm;
  const boomY = cableHeight + 0.35;
  const parts: TowerPart[] = [
    { name: 'Foundation', kind: 'box', a: [t.base.x, ground + (T.foundationTop - T.foundationDepth) / 2, t.base.z], b: [T.foundationHalf, (T.foundationTop + T.foundationDepth) / 2, T.foundationHalf], r: 0, role: 'Foundation' },
    { name: 'Mast', kind: 'beam', a: [t.base.x, ground + T.foundationTop, t.base.z], b: [t.base.x, top, t.base.z], r: T.mastHalf, role: 'Tower' },
    { name: 'Boom', kind: 'beam', a: [t.base.x, boomY, t.base.z], b: [t.apex.x, boomY, t.apex.z], r: T.boomHalf, role: 'Tower' },
    { name: 'Tie', kind: 'beam', a: [t.base.x, top, t.base.z], b: [t.apex.x, boomY, t.apex.z], r: T.tieHalf, role: 'Tower' },
    { name: 'Wheel', kind: 'disc', a: [t.apex.x, cableHeight + 0.1, t.apex.z], b: [0, T.wheelHalfThickness, 0], r: T.wheelRadius, role: 'Tower' },
  ];
  const reach = T.wireReach * (top - ground);
  for (const deg of T.wireAngles) {
    const r = (deg * Math.PI) / 180;
    const dx = t.out.x * Math.cos(r) - t.out.z * Math.sin(r);
    const dz = t.out.x * Math.sin(r) + t.out.z * Math.cos(r);
    const ax = Math.round((t.base.x + dx * reach) * 100) / 100;
    const az = Math.round((t.base.z + dz * reach) * 100) / 100;
    parts.push({ name: 'GuyWire', kind: 'beam', a: [t.base.x, top - 0.3, t.base.z], b: [ax, ground + T.anchorHalf, az], r: T.wireHalf, role: 'GuyWire' });
    parts.push({ name: 'Anchor', kind: 'box', a: [ax, ground + T.anchorHalf / 2, az], b: [T.anchorHalf, T.anchorHalf, T.anchorHalf], r: 0, role: 'Foundation' });
  }
  return parts;
}
