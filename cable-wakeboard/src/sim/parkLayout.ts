/**
 * The default park, laid out from the user's sketch: a five-tower "house"
 * loop (tall sides, a peaked roof to the north), about 586 m a lap, with the
 * obstacles where the sketch puts them. Scenery follows the user's park map
 * and photos: a lake with a long wooded island in the middle, a starting dock
 * on the south line, a watch terrace and clubhouse on the west shore, tents
 * and halls on the south shore, fields to the north.
 *
 * Sketch pixels were converted at 0.24 m/px (north up): x east, z south.
 * Travel is counter-clockwise seen from above (east along the south line,
 * north up the east side), so - offset (left of travel) is the inside of the
 * loop and + offset the outside. Tower order starts at the south-west tower so
 * s = 0 is on the south straight; the rider starts at the dock's east end.
 *
 * From the sketch, in order of travel:
 *   south line   South kicker (outside), met at the end of the lap
 *   east side    Inside kicker and East kicker as a pair, Small kicker, a buoy,
 *                Big kicker below the shoulder tower (outside)
 *   NE roof      Kick rail (outside), its kick ramp at the end riders meet first
 *   NW roof      Roof pipe (outside)
 *   west side    West box (outside), then two pipes inside the loop, side by side
 * Shapes the sketch draws far from the line are pulled in to 4-10 m off it,
 * which is what an 18 m rope can reach. Every obstacle faces the direction of
 * travel; the big kicker, kick rail and roof pipe sit a little before their
 * corner so riders land before the turn.
 *
 * roblox/src/shared/Sim/ParkLayout.luau is generated from this file:
 * `npx vite-node scripts/gen-park-luau.ts`. The towers are in config.ts
 * (`cable.towers`).
 */
import type { CatalogFeatureDef, ParkDef, SiteDef } from './park';
import { buildCablePath, cablePointAt } from './cable';
import { type CableConfig, DEFAULT_CONFIG } from './config';
import { FEATURE_CATALOG } from './featureCatalog';
import { atan2, cos, sin } from './math/detmath';
import type { GroundPoint } from './park';

export const LAKESIDE_PARK: ParkDef = {
  name: 'Sketch cable park',
  startS: 83,
  features: [
    { kind: 'kicker', id: 'k1', name: 'South kicker', s: 17.5, offset: 7, length: 3.8, width: 3, height: 0.9, lipAngle: 0.45 },
    { kind: 'kicker', id: 'k4', name: 'East kicker', s: 123, offset: 10, length: 4.5, width: 3.5, height: 1.2, lipAngle: 0.55 },
    { kind: 'kicker', id: 'k5', name: 'Inside kicker', s: 123, offset: -9, length: 4.5, width: 3.5, height: 1.2, lipAngle: 0.55 },
    { kind: 'kicker', id: 'k3', name: 'Small kicker', s: 167, offset: 8, length: 3.5, width: 2.8, height: 0.8, lipAngle: 0.45 },
    { kind: 'kicker', id: 'k2', name: 'Big kicker', s: 215, offset: 4, length: 6, width: 4.5, height: 1.8, lipAngle: 0.65 },
    { kind: 'slider', id: 'r1', name: 'Kick rail', style: 'rail', s: 280, offset: 7, length: 8, width: 0.12, height: 0.7, entryLength: 3, safety: 'gap' },
    { kind: 'slider', id: 't3', name: 'Roof pipe', style: 'tube', s: 362, offset: 8, length: 11, width: 0.4, height: 0.5, entryLength: 2.5, safety: 'flush' },
    { kind: 'slider', id: 'b1', name: 'West box', style: 'box', s: 439.5, offset: 7, length: 12, width: 1, height: 0.5, entryLength: 3, safety: 'flush' },
    { kind: 'slider', id: 't2', name: 'Long pipe', style: 'tube', s: 508, offset: -10, length: 12, width: 0.4, height: 0.55, entryLength: 2.5, safety: 'gap' },
    { kind: 'slider', id: 't1', name: 'Inside pipe', style: 'tube', s: 543, offset: -5, length: 10, width: 0.4, height: 0.5, entryLength: 2.5, safety: 'flush' },
  ],
  site: {
    lake: [
      { x: 81.3, z: -4.9 },
      { x: 82.8, z: 4.1 },
      { x: 83.3, z: 13.4 },
      { x: 82.8, z: 23 },
      { x: 81.3, z: 32.8 },
      { x: 79.7, z: 43.3 },
      { x: 78.6, z: 55.4 },
      { x: 78.3, z: 70.5 },
      { x: 78.8, z: 90.3 },
      { x: 79.5, z: 117 },
      { x: 65.5, z: 125.1 },
      { x: 48.6, z: 125.7 },
      { x: 32.7, z: 125.8 },
      { x: 17.6, z: 126.2 },
      { x: 2.9, z: 127.5 },
      { x: -12.3, z: 129.7 },
      { x: -28.6, z: 132.8 },
      { x: -46.4, z: 135.9 },
      { x: -66.2, z: 138.4 },
      { x: -83.5, z: 132.5 },
      { x: -82.7, z: 102.3 },
      { x: -81.6, z: 79.5 },
      { x: -80.8, z: 61.8 },
      { x: -80.7, z: 47.6 },
      { x: -81, z: 35.5 },
      { x: -81.3, z: 24.5 },
      { x: -80.9, z: 14.2 },
      { x: -79.7, z: 4.4 },
      { x: -78.1, z: -4.9 },
      { x: -76.7, z: -13.9 },
      { x: -76.2, z: -23 },
      { x: -76.9, z: -32.8 },
      { x: -78.4, z: -44.1 },
      { x: -80.2, z: -57.1 },
      { x: -81.4, z: -72.1 },
      { x: -80.3, z: -88.1 },
      { x: -68.3, z: -94.2 },
      { x: -56.8, z: -99.9 },
      { x: -45.7, z: -105.8 },
      { x: -34.7, z: -112.3 },
      { x: -23.3, z: -119.4 },
      { x: -10.9, z: -126.8 },
      { x: 2.9, z: -133.9 },
      { x: 18.2, z: -140.7 },
      { x: 31.3, z: -129.6 },
      { x: 40.7, z: -113.1 },
      { x: 48.6, z: -99.9 },
      { x: 55.9, z: -89.4 },
      { x: 63.2, z: -80.6 },
      { x: 70.3, z: -72.4 },
      { x: 77, z: -64.1 },
      { x: 78.2, z: -52.3 },
      { x: 78, z: -41.1 },
      { x: 77.8, z: -31.2 },
      { x: 78.3, z: -22.2 },
      { x: 79.6, z: -13.6 },
    ],
    islands: [
      { name: 'Island', height: 0.9, outline: [
          { x: 4.2, z: -42 },
          { x: 8.3, z: -34 },
          { x: 11.2, z: -26 },
          { x: 13.2, z: -18 },
          { x: 14.3, z: -10 },
          { x: 14.5, z: -2 },
          { x: 13.7, z: 6 },
          { x: 12, z: 14 },
          { x: 9.4, z: 22 },
          { x: 5.9, z: 30 },
          { x: 1.2, z: 38 },
          { x: -3.2, z: 38 },
          { x: -4.2, z: 30 },
          { x: -4.3, z: 22 },
          { x: -4.1, z: 14 },
          { x: -3.8, z: 6 },
          { x: -3.5, z: -2 },
          { x: -3.2, z: -10 },
          { x: -2.9, z: -18 },
          { x: -2.5, z: -26 },
          { x: -1.8, z: -34 },
          { x: -0.2, z: -42 },
        ] },
    ],
    docks: [{ name: 'Starting dock', s: 51, offset: 5, length: 17, width: 5.4 }],
    buildings: [
      { name: 'Clubhouse', x: -118, z: -58, width: 26, depth: 11, height: 4.5, heading: 1.25, roof: 'gable', color: 'cream' },
      { name: 'Service hut', x: -104, z: -96, width: 9, depth: 7, height: 3, heading: 0.6, roof: 'gable', color: 'cream' },
      { name: 'Kit shop', x: -118, z: -86, width: 10, depth: 7, height: 3, heading: 0.6, roof: 'gable', color: 'white' },
      { name: 'Watch tent 1', x: -106, z: -40, width: 4, depth: 4, height: 2.2, heading: 0, roof: 'tent', color: 'white' },
      { name: 'Watch tent 2', x: -106, z: -28, width: 4, depth: 4, height: 2.2, heading: 0, roof: 'tent', color: 'white' },
      { name: 'Watch tent 3', x: -106, z: -16, width: 4, depth: 4, height: 2.2, heading: 0, roof: 'tent', color: 'white' },
      { name: 'Watch tent 4', x: -106, z: -4, width: 4, depth: 4, height: 2.2, heading: 0, roof: 'tent', color: 'white' },
      { name: 'Watch tent 5', x: -106, z: 8, width: 4, depth: 4, height: 2.2, heading: 0, roof: 'tent', color: 'white' },
      { name: 'Watch tent 6', x: -106, z: 20, width: 4, depth: 4, height: 2.2, heading: 0, roof: 'tent', color: 'white' },
      { name: 'Watch tent 7', x: -106, z: 32, width: 4, depth: 4, height: 2.2, heading: 0, roof: 'tent', color: 'white' },
      { name: 'Watch tent 8', x: -106, z: 44, width: 4, depth: 4, height: 2.2, heading: 0, roof: 'tent', color: 'white' },
      { name: 'Watch tent 9', x: -106, z: 56, width: 4, depth: 4, height: 2.2, heading: 0, roof: 'tent', color: 'white' },
      { name: 'Watch tent 10', x: -106, z: 68, width: 4, depth: 4, height: 2.2, heading: 0, roof: 'tent', color: 'white' },
      { name: 'Watch tent 11', x: -106, z: 80, width: 4, depth: 4, height: 2.2, heading: 0, roof: 'tent', color: 'white' },
      { name: 'Beach tent 1', x: -48, z: 150, width: 4, depth: 4, height: 2.4, heading: 0, roof: 'tent', color: 'white' },
      { name: 'Beach tent 2', x: -38, z: 150, width: 4, depth: 4, height: 2.4, heading: 0, roof: 'tent', color: 'white' },
      { name: 'Beach tent 3', x: -30, z: 150, width: 4, depth: 4, height: 2.4, heading: 0, roof: 'tent', color: 'white' },
      { name: 'Beach tent 4', x: -22, z: 150, width: 7, depth: 5, height: 2.4, heading: 0, roof: 'tent', color: 'white' },
      { name: 'Beach tent 5', x: -12, z: 150, width: 7, depth: 5, height: 2.4, heading: 0, roof: 'tent', color: 'white' },
      { name: 'Beach tent 6', x: -2, z: 150, width: 4, depth: 4, height: 2.4, heading: 0, roof: 'tent', color: 'white' },
      { name: 'Beach tent 7', x: 8, z: 150, width: 4, depth: 4, height: 2.4, heading: 0, roof: 'tent', color: 'white' },
      { name: 'Beach tent 8', x: 16, z: 150, width: 4, depth: 4, height: 2.4, heading: 0, roof: 'tent', color: 'white' },
      { name: 'Beach tent 9', x: 24, z: 150, width: 4, depth: 4, height: 2.4, heading: 0, roof: 'tent', color: 'white' },
      { name: 'Beach tent 10', x: 34, z: 150, width: 4, depth: 4, height: 2.4, heading: 0, roof: 'tent', color: 'white' },
      { name: 'Beach tent 11', x: 44, z: 150, width: 4, depth: 4, height: 2.4, heading: 0, roof: 'tent', color: 'white' },
      { name: 'Beach tent 12', x: 52, z: 150, width: 4, depth: 4, height: 2.4, heading: 0, roof: 'tent', color: 'white' },
      { name: 'Event hall', x: 6, z: 166, width: 19, depth: 12, height: 6, heading: 0, roof: 'flat', color: 'white' },
      { name: 'Lodge', x: 72, z: 160, width: 26, depth: 10, height: 4, heading: -0.35, roof: 'gable', color: 'wood' },
      { name: 'Changing rooms', x: 42, z: 166, width: 12, depth: 12, height: 3.5, heading: 0, roof: 'flat', color: 'grey' },
    ],
    areas: [
      { kind: 'watch', name: 'Watch area', outline: [{ x: -81.7, z: -57.1 }, { x: -79.9, z: -44.1 }, { x: -78.4, z: -32.8 }, { x: -77.7, z: -23 }, { x: -78.2, z: -13.9 }, { x: -79.6, z: -4.9 }, { x: -81.2, z: 4.4 }, { x: -82.4, z: 14.2 }, { x: -82.8, z: 24.5 }, { x: -82.5, z: 35.5 }, { x: -82.2, z: 47.6 }, { x: -82.3, z: 61.8 }, { x: -83.1, z: 79.5 }, { x: -96.6, z: 79.5 }, { x: -95.8, z: 61.8 }, { x: -95.7, z: 47.6 }, { x: -96, z: 35.5 }, { x: -96.3, z: 24.5 }, { x: -95.9, z: 14.2 }, { x: -94.7, z: 4.4 }, { x: -93.1, z: -4.9 }, { x: -91.7, z: -13.9 }, { x: -91.2, z: -23 }, { x: -91.9, z: -32.8 }, { x: -93.4, z: -44.1 }, { x: -95.2, z: -57.1 }] },
      { kind: 'parking', name: 'West parking', outline: [{ x: -160, z: -6 }, { x: -134, z: -6 }, { x: -134, z: 18 }, { x: -160, z: 18 }] },
      { kind: 'parking', name: 'South parking', outline: [{ x: -96, z: 148 }, { x: -74, z: 152 }, { x: -78, z: 168 }, { x: -100, z: 164 }] },
      { kind: 'field', name: 'North field west', outline: [{ x: -300, z: -176 }, { x: -8, z: -170 }, { x: -8, z: -320 }, { x: -300, z: -320 }] },
      { kind: 'field', name: 'North field east', outline: [{ x: 12, z: -170 }, { x: 300, z: -176 }, { x: 300, z: -320 }, { x: 12, z: -320 }] },
      { kind: 'pond', name: 'Small pond', outline: [{ x: 117, z: -112 }, { x: 114.4, z: -107.1 }, { x: 108, z: -105 }, { x: 101.6, z: -107.1 }, { x: 99, z: -112 }, { x: 101.6, z: -116.9 }, { x: 108, z: -119 }, { x: 114.4, z: -116.9 }] },
    ],
    roads: [
      { name: 'Access road', width: 6, points: [{ x: -210, z: 6 }, { x: -160, z: 6 }, { x: -140, z: 40 }, { x: -128, z: 110 }, { x: -104, z: 172 }, { x: -60, z: 182 }, { x: 0, z: 184 }, { x: 80, z: 182 }] },
      { name: 'Field road', width: 5, points: [{ x: -300, z: -164 }, { x: -100, z: -160 }, { x: 0, z: -162 }, { x: 150, z: -158 }, { x: 300, z: -164 }] },
    ],
    buoys: [{ x: 67, z: 19.7 }],
  },
};

/**
 * Test map (spec section 16): a 1.2 m kicker, a flush funbox (safety + 6 m
 * box), a gap box and an 8 m rail, all right on the cable line of the south
 * and east straights so riding straight hits each one. Same lake and scenery
 * as the default park. Open it with `?park=test`.
 */
export const TEST_PARK: ParkDef = {
  name: 'Test map',
  startS: 30,
  features: [
    { kind: 'kicker', id: 'tk', name: 'Test kicker', s: 40, offset: 0, length: 4.5, width: 3.5, height: 1.2, lipAngle: 0.5 },
    { kind: 'slider', id: 'tf', name: 'Flush funbox', style: 'box', s: 120, offset: 0, length: 6, width: 1, height: 0.5, entryLength: 3, safety: 'flush' },
    { kind: 'slider', id: 'tg', name: 'Gap box', style: 'box', s: 170, offset: 0, length: 6, width: 0.8, height: 0.5, entryLength: 3, safety: 'gap' },
    { kind: 'slider', id: 'tr', name: '8 m rail', style: 'rail', s: 215, offset: 0, length: 8, width: 0.12, height: 0.6, entryLength: 3, safety: 'flush' },
  ],
  site: LAKESIDE_PARK.site,
};

/**
 * Every wake park catalogue feature (featureCatalog.ts) on the cable line,
 * one after another round the loop, for tests and the TypeScript / Luau
 * parity check. Open it with `?park=catalog`.
 */
export const CATALOG_TEST_PARK: ParkDef = {
  name: 'Catalogue test map',
  startS: 12,
  features: (
    [
      // Straights (s): south 0-88, east 107-249, north-east 257-310, north-west 327-391, west 404-566.
      // Every feature has 20 m or more of straight cable before it and room to land after.
      ['BeginnerKicker', 26], ['Slider', 48], ['Spine', 66],
      ['Funbox', 132], ['MediumKicker', 160], ['PipeRail', 185], ['GapBox', 212],
      ['FlatRail', 288],
      ['WallRide', 342], ['KinkRail', 366],
      ['Transfer', 428], ['Rooftop', 452], ['StepUp', 478], ['Pyramid', 505], ['ProKicker', 530],
    ] as const
  ).map(([catalog, s]) => ({
    kind: 'feature' as const, id: `cat_${catalog}`, name: catalog, catalog, s,
    // The wall ride is turned into the riders' line so the pull carries them up it;
    // the transfer box sits off the line with its second box toward the cable, so the pull helps the hop across.
    ...(catalog === 'WallRide' ? { offset: 2, yaw: -0.6, side: 1 } : catalog === 'Transfer' ? { offset: 3, side: -1 } : { offset: 0 }),
  })),
  site: LAKESIDE_PARK.site,
};

/**
 * A placement in the features spec's own terms (section 9): which straight of
 * the cable (1-based, in order of travel from s = 0), how far along it, how
 * far off the cable line (+ right of travel), and which way it faces.
 */
export interface LayoutEntry {
  id: string;
  catalog: string;
  params?: CatalogFeatureDef['params'];
  segmentOfCable: number;
  distanceAlong: number;
  sideOffset: number;
  facing: 'WithCable' | 'AgainstCable' | number;
  line: string;
  accent: string;
  /** Transfer box / wall ride: which side the second box or the wall is on. */
  side?: number;
  name?: string;
}

/** Arc length where each straight of a cable starts, and its length, in order of travel. */
export function cableStraights(cable: CableConfig): { s0: number; length: number }[] {
  const path = buildCablePath(cable);
  if (path.shuttle) return [{ s0: 0, length: path.segments[0]!.length }];
  return path.segments.filter((g) => g.kind === 'line').map((g) => ({ s0: g.s0, length: g.length }));
}

/** Layout entries to feature defs on a cable. */
export function placeLayout(entries: LayoutEntry[], cable: CableConfig): CatalogFeatureDef[] {
  const straights = cableStraights(cable);
  return entries.map((e) => {
    const st = straights[e.segmentOfCable - 1];
    if (!st) throw new Error(`${e.id}: no straight ${e.segmentOfCable}`);
    if (e.distanceAlong < 0 || e.distanceAlong > st.length) throw new Error(`${e.id}: ${e.distanceAlong} m is off straight ${e.segmentOfCable}`);
    const yaw = e.facing === 'WithCable' ? 0 : e.facing === 'AgainstCable' ? Math.PI : e.facing;
    return {
      kind: 'feature',
      id: e.id,
      name: e.name ?? FEATURE_CATALOG[e.catalog]!.meta.label,
      catalog: e.catalog,
      ...(e.params ? { params: e.params } : {}),
      s: st.s0 + e.distanceAlong,
      offset: e.sideOffset,
      ...(yaw !== 0 ? { yaw } : {}),
      ...(e.side !== undefined ? { side: e.side } : {}),
      accent: e.accent,
      line: e.line,
    };
  });
}

/**
 * The wake park's lines (features spec section 9) on the user's loop. The
 * loop's straights in order of travel (segmentOfCable): 1 south (88 m,
 * east-bound, the start dock on its outside), 2 east (143 m), 3 north-east
 * (53 m), 4 north-west (64 m), 5 west (162 m). + offset is right of travel:
 * the outside of the loop. Section 5's clearance (8 m along the approach,
 * 12 m after the exit) needs about 20 m between features, so the lines fit
 * the straights' real lengths:
 *   Line 1  medium kicker, pipe rail, funbox    east
 *   Line 2  gap box, flat-down rail, transfer   west
 *   Line 3  pro kicker, rooftop, step-up rail   the end of the west straight,
 *                                               then the south before the dock
 *   Line 4  pyramid, wall ride, spine           the roof (north-east, north-west)
 */
export const WAKE_PARK_LAYOUT: LayoutEntry[] = [
  { id: 'L1_MediumKicker_01', catalog: 'MediumKicker', segmentOfCable: 2, distanceAlong: 18, sideOffset: 4, facing: 'WithCable', line: 'Line 1', accent: 'Orange' },
  { id: 'L1_PipeRail_01', catalog: 'PipeRail', segmentOfCable: 2, distanceAlong: 48, sideOffset: 3, facing: 'WithCable', line: 'Line 1', accent: 'Orange' },
  { id: 'L1_Funbox_01', catalog: 'Funbox', segmentOfCable: 2, distanceAlong: 83, sideOffset: 3, facing: 'WithCable', line: 'Line 1', accent: 'Orange' },
  { id: 'L4_Pyramid_01', catalog: 'Pyramid', segmentOfCable: 3, distanceAlong: 14, sideOffset: 4, facing: 'WithCable', line: 'Line 4', accent: 'Magenta' },
  { id: 'L4_WallRide_01', catalog: 'WallRide', segmentOfCable: 3, distanceAlong: 41, sideOffset: 2, facing: -0.6, line: 'Line 4', accent: 'Magenta', side: 1 },
  { id: 'L4_Spine_01', catalog: 'Spine', segmentOfCable: 4, distanceAlong: 14, sideOffset: 3, facing: 'WithCable', line: 'Line 4', accent: 'Magenta' },
  { id: 'L2_GapBox_01', catalog: 'GapBox', segmentOfCable: 5, distanceAlong: 16, sideOffset: 3, facing: 'WithCable', line: 'Line 2', accent: 'Teal' },
  { id: 'L2_KinkRail_01', catalog: 'KinkRail', segmentOfCable: 5, distanceAlong: 49, sideOffset: 3, facing: 'WithCable', line: 'Line 2', accent: 'Teal' },
  { id: 'L2_Transfer_01', catalog: 'Transfer', segmentOfCable: 5, distanceAlong: 85, sideOffset: 4, facing: 'WithCable', line: 'Line 2', accent: 'Teal', side: -1 },
  { id: 'L3_ProKicker_01', catalog: 'ProKicker', segmentOfCable: 5, distanceAlong: 116, sideOffset: 4, facing: 'WithCable', line: 'Line 3', accent: 'Yellow' },
  { id: 'L3_Rooftop_01', catalog: 'Rooftop', segmentOfCable: 5, distanceAlong: 148, sideOffset: 3, facing: 'WithCable', line: 'Line 3', accent: 'Yellow' },
  { id: 'L3_StepUp_01', catalog: 'StepUp', segmentOfCable: 1, distanceAlong: 15, sideOffset: 3, facing: 'WithCable', line: 'Line 3', accent: 'Yellow' },
];

/**
 * The beginner 2-tower system (spec section 9): one 150 m line in its own
 * lagoon, inside the ring island in the middle of the loop (layout spec
 * milestone 4: both towers on the island, out of every riding area). The
 * carrier runs out north-east and back; the features face the outbound run.
 */
export const BEGINNER_CABLE: Partial<CableConfig> = {
  mode: 'twoTower',
  towers: [{ x: 22.5, z: 40 }, { x: 97.5, z: -90 }],
};

export const BEGINNER_LAYOUT: LayoutEntry[] = [
  { id: 'B_Slider_01', catalog: 'Slider', segmentOfCable: 1, distanceAlong: 28, sideOffset: 3, facing: 'WithCable', line: 'Beginner', accent: 'Teal' },
  { id: 'B_BeginnerKicker_01', catalog: 'BeginnerKicker', segmentOfCable: 1, distanceAlong: 62, sideOffset: 3, facing: 'WithCable', line: 'Beginner', accent: 'Teal' },
  {
    id: 'B_Funbox_01', catalog: 'Funbox', segmentOfCable: 1, distanceAlong: 96, sideOffset: 3, facing: 'WithCable', line: 'Beginner', accent: 'Teal',
    // A lower funbox for the beginner line.
    params: { mains: [{ height: 0.6, gapBefore: 0, kinks: [{ length: 6, angle: 0 }] }], safetyLength: 2.2, exitLength: 2.2 },
  },
];

/**
 * Real-park site rules (layout spec section 2): the towers stand on land,
 * the cable's corners hang off an arm over the water, and the lake is drawn
 * round the loop so riders and features keep their distance from the shore.
 */
export const SHORE_RULES = {
  /** Lake shore at least this far outside the cable along the straights (m). */
  margin: 28,
  /** Tower arm: the base stands this far beyond the cable corner (m), along the corner's outward bisector. */
  arm: 8,
  /** Headland radius round a tower base (m): 8 m of land beyond the 1.5 m foundation, and 1 m spare. */
  head: 10.5,
  /** Foundation half-size (m). */
  foundation: 1.5,
};

/** One tower of a cable system: where the cable turns (the wheel) and where the mast stands. */
export interface TowerSite {
  /** The cable corner: the carrier wheel at the top of the tower, over the water. */
  wheel: GroundPoint;
  /** Mast base, on land. */
  base: GroundPoint;
  /** Unit vector from the wheel to the base (outward bisector, or along the line for a 2-tower system). */
  out: GroundPoint;
  /** Arm length (m), wheel to base. */
  arm: number;
  /**
   * Where the cable passes the tower: the middle of its corner arc (the
   * cable is filleted, so it runs `cornerRadius (sec(turn / 2) - 1)` inside
   * the corner point), or the line's end for a 2-tower system. The boom and
   * the wheel reach this point.
   */
  apex: GroundPoint;
}

const unit = (x: number, z: number): GroundPoint => {
  const l = Math.sqrt(x * x + z * z);
  return { x: x / l, z: z / l };
};
const r1 = (v: number) => Math.round(v * 10) / 10;

/** Tower sites of a cable: loop corners get the outward bisector, a 2-tower system its line ends. */
export function towerSites(cable: CableConfig, arm: number | number[] = SHORE_RULES.arm): TowerSite[] {
  const t = cable.towers;
  const armOf = (i: number) => (typeof arm === 'number' ? arm : arm[i] ?? SHORE_RULES.arm);
  if (cable.mode === 'twoTower') {
    const d = unit(t[1]!.x - t[0]!.x, t[1]!.z - t[0]!.z);
    const [a0, a1] = [armOf(0), armOf(1)];
    return [
      { wheel: t[0]!, out: { x: -d.x, z: -d.z }, arm: a0, base: { x: r1(t[0]!.x - d.x * a0), z: r1(t[0]!.z - d.z * a0) }, apex: t[0]! },
      { wheel: t[1]!, out: d, arm: a1, base: { x: r1(t[1]!.x + d.x * a1), z: r1(t[1]!.z + d.z * a1) }, apex: t[1]! },
    ];
  }
  const n = t.length;
  return t.map((p, i) => {
    const a = t[(i + n - 1) % n]!;
    const b = t[(i + 1) % n]!;
    // Right of travel is the outside of the loop: rightOf(heading) = (-sin, cos) = (-dz, dx).
    const dIn = unit(p.x - a.x, p.z - a.z);
    const dOut = unit(b.x - p.x, b.z - p.z);
    const out = unit(-dIn.z - dOut.z, dIn.x + dOut.x);
    const len = armOf(i);
    const cosHalf = Math.sqrt(Math.max((1 + dIn.x * dOut.x + dIn.z * dOut.z) / 2, 1e-9));
    const inset = cable.cornerRadius * (1 / cosHalf - 1);
    return {
      wheel: p, out, arm: len,
      base: { x: r1(p.x + out.x * len), z: r1(p.z + out.z * len) },
      apex: { x: r1(p.x - out.x * inset), z: r1(p.z - out.z * inset) },
    };
  });
}

/** Where two lines (point + direction) meet. */
function meet(p: GroundPoint, d: GroundPoint, q: GroundPoint, e: GroundPoint): GroundPoint {
  const den = d.x * e.z - d.z * e.x;
  const t = ((q.x - p.x) * e.z - (q.z - p.z) * e.x) / den;
  return { x: p.x + d.x * t, z: p.z + d.z * t };
}

/**
 * A loop's lake: every straight's shore `margin` m outside the cable (bowed
 * out up to 3 m between towers), each tower base on a headland `head` m from
 * the water. Built from rays out of the loop's centre: each stops at the
 * shore line or the first headland it meets, so the outline is star-shaped
 * by construction (the land ring needs it) and the land behind each head is
 * its neck. Clockwise seen from above, like the sketch lake.
 */
export function shoreFor(cable: CableConfig, arms: number | number[] = SHORE_RULES.arm, rules = SHORE_RULES): GroundPoint[] {
  const t = cable.towers;
  const n = t.length;
  const sites = towerSites(cable, arms);
  const c = { x: t.reduce((a, p) => a + p.x, 0) / n, z: t.reduce((a, p) => a + p.z, 0) / n };
  // The shore line: offset corners and bowed points between them, in travel order.
  const ring: GroundPoint[] = [];
  for (let i = 0; i < n; i++) {
    const p = t[i]!;
    const prev = t[(i + n - 1) % n]!;
    const next = t[(i + 1) % n]!;
    const dIn = unit(p.x - prev.x, p.z - prev.z);
    const dOut = unit(next.x - p.x, next.z - p.z);
    ring.push(meet({ x: p.x - dIn.z * rules.margin, z: p.z + dIn.x * rules.margin }, dIn, { x: p.x - dOut.z * rules.margin, z: p.z + dOut.x * rules.margin }, dOut));
    const len = Math.sqrt((next.x - p.x) * (next.x - p.x) + (next.z - p.z) * (next.z - p.z));
    const m = Math.max(2, Math.floor(len / 30));
    for (let k = 1; k < m; k++) {
      const u = k / m;
      const bow = Math.max(3 * sin(Math.PI * u) + 0.8 * sin(5.3 * u + i), 0);
      ring.push({ x: p.x + (next.x - p.x) * u - dOut.z * (rules.margin + bow), z: p.z + (next.z - p.z) * u + dOut.x * (rules.margin + bow) });
    }
  }
  const rayTo = (ux: number, uz: number): number => {
    let best = Infinity;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      const ex = b.x - a.x;
      const ez = b.z - a.z;
      const den = ux * ez - uz * ex;
      if (Math.abs(den) < 1e-12) continue;
      const tt = ((a.x - c.x) * ez - (a.z - c.z) * ex) / den;
      const v = ((a.x - c.x) * uz - (a.z - c.z) * ux) / den;
      if (tt > 0 && v >= 0 && v <= 1) best = Math.min(best, tt);
    }
    for (const site of sites) {
      const bx = site.base.x - c.x;
      const bz = site.base.z - c.z;
      const along = bx * ux + bz * uz;
      const off2 = bx * bx + bz * bz - along * along;
      if (along > 0 && off2 < rules.head * rules.head) best = Math.min(best, along - Math.sqrt(rules.head * rules.head - off2));
    }
    return best;
  };
  // Rays every degree, plus a fan across each headland for a round head.
  const angles: number[] = [];
  for (let k = 0; k < 360; k++) angles.push((k * Math.PI) / 180 - Math.PI);
  for (const site of sites) {
    const bx = site.base.x - c.x;
    const bz = site.base.z - c.z;
    const dist = Math.sqrt(bx * bx + bz * bz);
    const a0 = atan2(bz, bx);
    const half = atan2(rules.head, Math.sqrt(Math.max(dist * dist - rules.head * rules.head, 1e-9)));
    for (let k = -6; k <= 6; k++) angles.push(a0 + (half * k) / 6.2);
  }
  const wrap = (a: number) => (a > Math.PI ? a - 2 * Math.PI : a < -Math.PI ? a + 2 * Math.PI : a);
  const sorted = angles.map(wrap).sort((a, b) => a - b);
  const pts: GroundPoint[] = [];
  for (const a of sorted) {
    const ux = cos(a);
    const uz = sin(a);
    const r = rayTo(ux, uz);
    const q = { x: r1(c.x + ux * r), z: r1(c.z + uz * r) };
    const last = pts[pts.length - 1];
    if (!last || Math.abs(last.x - q.x) + Math.abs(last.z - q.z) > 0.15) pts.push(q);
  }
  // Angles increase clockwise seen from above (z is south), as the sketch lake runs.
  return pts;
}

/**
 * A 2-tower system's lagoon inside a ring island: water `halfWidth` either
 * side of the cable, round-ended so each tower base is `head` from the
 * water; the island ring `ring` m wide round it, as two halves (north and
 * south of the line) so each is a simple polygon.
 */
export function lagoonIsland(cable: CableConfig, halfWidth = 30, ring = 20, rules = SHORE_RULES, arm: number | number[] = rules.arm): { lagoon: GroundPoint[]; halves: GroundPoint[][] } {
  const [s0, s1] = towerSites(cable, arm);
  const d = unit(s1!.wheel.x - s0!.wheel.x, s1!.wheel.z - s0!.wheel.z);
  const p = { x: -d.z, z: d.x };
  // Semicircle centres: far enough in that the tip is `head` short of the base.
  const e0 = { x: s0!.base.x + d.x * (halfWidth + rules.head), z: s0!.base.z + d.z * (halfWidth + rules.head) };
  const e1 = { x: s1!.base.x - d.x * (halfWidth + rules.head), z: s1!.base.z - d.z * (halfWidth + rules.head) };
  const half = (r: number, sgn: number): GroundPoint[] => {
    // From the tip at the first tower round the `sgn` side to the tip at the second.
    const out: GroundPoint[] = [];
    const a0 = atan2(-d.z, -d.x);
    // The tips (k = 0 and 12) lie on the line: the same points for both halves.
    out.push({ x: e0.x - d.x * r, z: e0.z - d.z * r });
    for (let k = 1; k <= 6; k++) {
      const ang = a0 - (sgn * (k * Math.PI)) / 12;
      out.push({ x: e0.x + cos(ang) * r, z: e0.z + sin(ang) * r });
    }
    for (let k = 6; k < 12; k++) {
      const ang = a0 - (sgn * (k * Math.PI)) / 12;
      out.push({ x: e1.x + cos(ang) * r, z: e1.z + sin(ang) * r });
    }
    out.push({ x: e1.x + d.x * r, z: e1.z + d.z * r });
    return out.map((q) => ({ x: r1(q.x), z: r1(q.z) }));
  };
  const lagoon = [...half(halfWidth, 1), ...half(halfWidth, -1).reverse().slice(1, -1)];
  const halves = [1, -1].map((sgn) => [...half(halfWidth + ring, sgn), ...half(halfWidth, sgn).reverse()]);
  void p;
  return { lagoon, halves };
}

/**
 * Marker buoys along the lines: on the other side of the cable from each
 * line's features (out of their approach and landing zones), at the start
 * and end of every straight that has features.
 */
function lineBuoys(entries: LayoutEntry[], cable: CableConfig): { x: number; z: number }[] {
  const path = buildCablePath(cable);
  const straights = cableStraights(cable);
  const out: { x: number; z: number }[] = [];
  const seen = new Set<number>();
  for (const e of entries) {
    if (seen.has(e.segmentOfCable)) continue;
    seen.add(e.segmentOfCable);
    const st = straights[e.segmentOfCable - 1]!;
    for (const along of [6, st.length - 6]) {
      const p = cablePointAt(path, st.s0 + along);
      const off = -Math.sign(e.sideOffset) * 9;
      out.push({ x: Math.round((p.pos.x - sin(p.heading) * off) * 10) / 10, z: Math.round((p.pos.z + cos(p.heading) * off) * 10) / 10 });
    }
  }
  return out;
}

/**
 * The wake park's loop (layout spec milestone 4): five towers on the shore,
 * counter-clockwise, about 912 m a lap. Straights in order of travel (s = 0
 * leaves tower 0): S1 165 m (north-east), S2 172 m (north-west), S3 178 m
 * (south-west), S4 190 m (the west side, south), S5 131 m (the south side,
 * east, with the start dock near its end). Sized for the target layout under
 * the real-park rules (docs/LAYOUT.md): three features need about 155-180 m
 * of straight once the corner zones, the 20-80 % band, run-outs and
 * approaches are kept clear.
 */
export const WAKE_CABLE: Partial<CableConfig> = {
  towers: [{ x: 92, z: 111 }, { x: 221, z: -13 }, { x: 124, z: -179 }, { x: -56, z: -100 }, { x: -56, z: 110 }],
};
/**
 * Arm of each tower (m): the base stands this far beyond its cable corner,
 * on a headland 8 m inland of water that riders keep 10 m from. Solved from
 * the rider's envelope (no input, and weaving edge to edge every 1-3 s, from
 * five starts round the loop; scripts/lapTest.ts checks it): riders pass
 * within a few metres of a cable corner, so the masts stand 26-30 m back and
 * a boom carries the wheel out (docs/LAYOUT.md, milestone 4).
 */
export const WAKE_TOWER_ARMS = [30, 27, 27, 28, 26];
/** The beginner towers' arms: the shuttle rider runs nearly to the far tower. */
export const BEGINNER_TOWER_ARMS = [24, 24];

const wakeCable: CableConfig = { ...DEFAULT_CONFIG.cable, ...WAKE_CABLE };
const beginnerCable: CableConfig = { ...DEFAULT_CONFIG.cable, ...BEGINNER_CABLE };
const WAKE_LAKE = shoreFor(wakeCable, WAKE_TOWER_ARMS);
const BEGINNER_LAGOON = lagoonIsland(beginnerCable, 30, 22, SHORE_RULES, BEGINNER_TOWER_ARMS);

/** The leftmost shore point of a lake at height z (its west shore). */
function westShoreAt(lake: GroundPoint[], z: number): number {
  let best = Infinity;
  for (let i = 0; i < lake.length; i++) {
    const a = lake[i]!;
    const b = lake[(i + 1) % lake.length]!;
    if ((a.z - z) * (b.z - z) > 0 || a.z === b.z) continue;
    best = Math.min(best, a.x + ((b.x - a.x) * (z - a.z)) / (b.z - a.z));
  }
  return best;
}

/** The watch terrace along the west shore: 1-13 m back from the water. */
const watchArea = (lake: GroundPoint[]): GroundPoint[] => {
  const zs: number[] = [];
  for (let z = -57; z <= 79; z += 8.5) zs.push(z);
  const inner = zs.map((z) => ({ x: r1(westShoreAt(lake, z) - 1), z }));
  const outer = zs.map((z) => ({ x: r1(westShoreAt(lake, z) - 13), z })).reverse();
  return [...inner, ...outer];
};

/**
 * The site round the new lake: the sketch's buildings, roads, parking and
 * watch terrace on the west and south shores where they were, the fields
 * and field road moved north of the grown lake, the pond moved east, the
 * ring island with the beginner lagoon in the middle, both cable systems'
 * towers on land, and the cable operator hut by the start dock.
 */
const WAKE_SITE: SiteDef = {
  ...LAKESIDE_PARK.site!,
  lake: WAKE_LAKE,
  islands: BEGINNER_LAGOON.halves.map((outline, i) => ({ name: i === 0 ? 'Island north' : 'Island south', outline, height: 0.9 })),
  docks: [{ name: 'Starting dock', s: 0, offset: 5, length: 17, width: 5.4 }],
  buildings: [
    ...LAKESIDE_PARK.site!.buildings,
    { name: 'Cable operator hut', x: 52, z: 147, width: 4.5, depth: 3.5, height: 2.8, heading: 0, roof: 'flat', color: 'wood' },
  ],
  areas: LAKESIDE_PARK.site!.areas.map((a) => {
    if (a.kind === 'watch') return { ...a, outline: watchArea(WAKE_LAKE) };
    if (a.kind === 'field') return { ...a, outline: a.outline.map((p) => ({ x: p.x, z: p.z - 65 })) };
    if (a.kind === 'pond') return { ...a, outline: a.outline.map((p) => ({ x: p.x + 190, z: p.z - 20 })) };
    return a;
  }),
  roads: LAKESIDE_PARK.site!.roads.map((r) => (r.name === 'Field road' ? { ...r, points: r.points.map((p) => ({ x: p.x, z: p.z - 65 })) } : r)),
  buoys: [],
  cables: [
    { name: 'Main loop', mode: 'loop', towers: towerSites(wakeCable, WAKE_TOWER_ARMS) },
    { name: 'Beginner line', mode: 'twoTower', towers: towerSites(beginnerCable, BEGINNER_TOWER_ARMS) },
  ],
};
// The start dock near the end of S5, on the outside (the south shore side).
{
  const s5 = cableStraights(wakeCable)[4]!;
  WAKE_SITE.docks[0]!.s = r1(s5.s0 + 98);
}
// Milestone 4 keeps the features spec's lines; the loop's straights moved round
// by one (the old south straight is now S5), and milestone 5 re-lays them.
const WAKE_LINES = WAKE_PARK_LAYOUT.map((e) => ({ ...e, segmentOfCable: e.segmentOfCable === 1 ? 5 : e.segmentOfCable - 1 }));
WAKE_SITE.buoys = lineBuoys(WAKE_LINES, wakeCable);

/** The wake park (default): the spec's lines on the loop, the grown lake. */
export const WAKE_PARK: ParkDef = {
  name: 'Lakeside Wake',
  startS: r1(WAKE_SITE.docks[0]!.s + 32),
  cable: WAKE_CABLE,
  features: placeLayout(WAKE_LINES, wakeCable),
  site: WAKE_SITE,
};

/**
 * The beginner 2-tower system as its own map (`?park=beginner`): the same
 * site, its own start dock by the first tower and its own buoys.
 */
export const BEGINNER_PARK: ParkDef = {
  name: 'Beginner line',
  startS: 22,
  cable: BEGINNER_CABLE,
  features: placeLayout(BEGINNER_LAYOUT, beginnerCable),
  site: {
    ...WAKE_SITE,
    docks: [{ name: 'Beginner dock', s: 2, offset: -8, length: 8, width: 4 }],
    buoys: lineBuoys(BEGINNER_LAYOUT, beginnerCable),
  },
};
