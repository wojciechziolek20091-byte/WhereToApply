/**
 * The lakeside cable park from the user's map (5 towers, about 600 m a lap,
 * an island in the middle, a starting dock between two kickers on the south
 * line). Map pixels were converted at 0.215 m/px with the map centre at the
 * origin: x east, z south. Travel is clockwise seen from above, so + offset
 * (right of travel) is the inside of the loop.
 *
 * Tower order starts at tower 4 (south-east) so s = 0 is on the long south
 * straight and the starting dock runs from s = 70 to 87, where the rider starts. Obstacles that the map draws
 * far inside the loop are pulled in to 6-10 m off the line, where a rider on
 * an 18 m rope can reach them; their order along the lap follows the map.
 *
 * roblox/src/shared/Sim/ParkLayout.luau is generated from this file:
 * `npx vite-node scripts/gen-park-luau.ts`. The towers are in config.ts
 * (`cable.towers`).
 */
import type { ParkDef } from './park';

export const LAKESIDE_PARK: ParkDef = {
  name: 'Lakeside cable park',
  startS: 103,
  features: [
    { kind: 'slider', id: 'r1', name: 'East rail', style: 'rail', s: 20, offset: 9, length: 10, width: 0.12, height: 0.5, entryLength: 3 },
    { kind: 'kicker', id: 'k1', name: 'Big kicker', s: 40, offset: 10, length: 5.5, width: 4, height: 1.6, lipAngle: 0.6 },
    { kind: 'kicker', id: 'k2', name: 'Dock kicker east', s: 63, offset: 0, length: 4.5, width: 3.5, height: 1.1, lipAngle: 0.5 },
    { kind: 'kicker', id: 'k3', name: 'Dock kicker west', s: 110, offset: 0, length: 4.5, width: 3.5, height: 1.1, lipAngle: 0.5 },
    { kind: 'slider', id: 'r2', name: 'South rail', style: 'rail', s: 140, offset: 8, length: 8, width: 0.12, height: 0.6, entryLength: 3 },
    { kind: 'kicker', id: 'k4', name: 'Small kicker', s: 172, offset: 7, length: 3.8, width: 3, height: 0.9, lipAngle: 0.45 },
    { kind: 'slider', id: 'r3', name: 'West rail', style: 'rail', s: 228, offset: 9, length: 10, width: 0.12, height: 0.5, entryLength: 3 },
    { kind: 'kicker', id: 'k5', name: 'West kicker', s: 258, offset: 8, length: 4.2, width: 3.2, height: 1.2, lipAngle: 0.55 },
    { kind: 'kicker', id: 'k6', name: 'North kicker', s: 322, offset: 8, length: 4.5, width: 3.5, height: 1.2, lipAngle: 0.55 },
    { kind: 'kicker', id: 'k7', name: 'Northeast kicker', s: 462, offset: 9, length: 4.2, width: 3.2, height: 1.3, lipAngle: 0.55 },
    { kind: 'slider', id: 'r4', name: 'Diagonal rail', style: 'rail', s: 490, offset: 8, length: 10, width: 0.12, height: 0.5, entryLength: 3 },
    { kind: 'kicker', id: 'k8', name: 'Corner kicker', s: 560, offset: 6, length: 3.8, width: 3, height: 1, lipAngle: 0.5 },
  ],
  site: {
    lake: [
      { x: -94.2, z: -90.3 },
      { x: -57.6, z: -90.3 },
      { x: -14.6, z: -88.6 },
      { x: 28.4, z: -89.4 },
      { x: 58.5, z: -87.7 },
      { x: 68.2, z: -78.3 },
      { x: 80, z: -71 },
      { x: 96.1, z: -58.9 },
      { x: 112.2, z: -46 },
      { x: 127.3, z: -31 },
      { x: 140.2, z: -15.9 },
      { x: 148.8, z: 0.6 },
      { x: 157.4, z: 14.6 },
      { x: 157.4, z: 28.6 },
      { x: 149.9, z: 40.4 },
      { x: 133.7, z: 47.9 },
      { x: 103.6, z: 51.6 },
      { x: 71.4, z: 53.3 },
      { x: 28.4, z: 55 },
      { x: -14.6, z: 55 },
      { x: -49, z: 52.2 },
      { x: -74.8, z: 46.4 },
      { x: -100.6, z: 36.1 },
      { x: -122.1, z: 24.3 },
      { x: -135, z: 12.5 },
      { x: -139.8, z: -2.6 },
      { x: -137.6, z: -19.8 },
      { x: -130.7, z: -39.1 },
      { x: -120, z: -62.8 },
      { x: -110.3, z: -80 },
    ],
    islands: [
      { name: 'Island', height: 0.9, outline: [
          { x: -17.2, z: -56.8 },
          { x: -10.8, z: -55.9 },
          { x: -6, z: -49.9 },
          { x: -4.9, z: -39.1 },
          { x: -3.4, z: -26.2 },
          { x: 0, z: -13.3 },
          { x: 4.7, z: -2.6 },
          { x: 5.2, z: 7.1 },
          { x: 0.4, z: 10.3 },
          { x: -4.9, z: 7.1 },
          { x: -9.2, z: -2.6 },
          { x: -14.6, z: -15.5 },
          { x: -18.5, z: -28.4 },
          { x: -22.1, z: -41.3 },
          { x: -24.3, z: -49.9 },
          { x: -22.1, z: -55.3 },
        ] },
    ],
    docks: [{ name: 'Starting dock', s: 70, offset: -5, length: 17, width: 5.4 }],
    buildings: [
      { name: 'Clubhouse', x: -170, z: -60, width: 26, depth: 11, height: 4.5, heading: -0.69, roof: 'gable', color: 'cream' },
      { name: 'Service hut', x: -140, z: -96, width: 9, depth: 7, height: 3, heading: -0.69, roof: 'gable', color: 'cream' },
      { name: 'Kit shop', x: -157, z: -88, width: 10, depth: 7, height: 3, heading: -0.69, roof: 'gable', color: 'white' },
      { name: 'Watch tent 1', x: -161, z: -52, width: 4, depth: 4, height: 2.2, heading: 0, roof: 'tent', color: 'white' },
      { name: 'Watch tent 2', x: -161, z: -42, width: 4, depth: 4, height: 2.2, heading: 0, roof: 'tent', color: 'white' },
      { name: 'Watch tent 3', x: -161, z: -32, width: 4, depth: 4, height: 2.2, heading: 0, roof: 'tent', color: 'white' },
      { name: 'Watch tent 4', x: -161, z: -22, width: 4, depth: 4, height: 2.2, heading: 0, roof: 'tent', color: 'white' },
      { name: 'Watch tent 5', x: -161, z: -12, width: 4, depth: 4, height: 2.2, heading: 0, roof: 'tent', color: 'white' },
      { name: 'Watch tent 6', x: -161, z: -2, width: 4, depth: 4, height: 2.2, heading: 0, roof: 'tent', color: 'white' },
      { name: 'Watch tent 7', x: -161, z: 8, width: 4, depth: 4, height: 2.2, heading: 0, roof: 'tent', color: 'white' },
      { name: 'Beach tent 1', x: -44, z: 62, width: 4, depth: 4, height: 2.4, heading: 0, roof: 'tent', color: 'white' },
      { name: 'Beach tent 2', x: -34, z: 62, width: 4, depth: 4, height: 2.4, heading: 0, roof: 'tent', color: 'white' },
      { name: 'Beach tent 3', x: -26, z: 62, width: 4, depth: 4, height: 2.4, heading: 0, roof: 'tent', color: 'white' },
      { name: 'Beach tent 4', x: -18, z: 62, width: 7, depth: 5, height: 2.4, heading: 0, roof: 'tent', color: 'white' },
      { name: 'Beach tent 5', x: -8, z: 62, width: 7, depth: 5, height: 2.4, heading: 0, roof: 'tent', color: 'white' },
      { name: 'Beach tent 6', x: 2, z: 62, width: 4, depth: 4, height: 2.4, heading: 0, roof: 'tent', color: 'white' },
      { name: 'Beach tent 7', x: 10, z: 62, width: 4, depth: 4, height: 2.4, heading: 0, roof: 'tent', color: 'white' },
      { name: 'Beach tent 8', x: 18, z: 62, width: 4, depth: 4, height: 2.4, heading: 0, roof: 'tent', color: 'white' },
      { name: 'Beach tent 9', x: 26, z: 62, width: 4, depth: 4, height: 2.4, heading: 0, roof: 'tent', color: 'white' },
      { name: 'Beach tent 10', x: 36, z: 62, width: 4, depth: 4, height: 2.4, heading: 0, roof: 'tent', color: 'white' },
      { name: 'Beach tent 11', x: 46, z: 62, width: 4, depth: 4, height: 2.4, heading: 0, roof: 'tent', color: 'white' },
      { name: 'Beach tent 12', x: 54, z: 62, width: 4, depth: 4, height: 2.4, heading: 0, roof: 'tent', color: 'white' },
      { name: 'Event hall', x: 14, z: 74, width: 19, depth: 12, height: 6, heading: 0, roof: 'flat', color: 'white' },
      { name: 'Lodge', x: 100, z: 68, width: 26, depth: 10, height: 4, heading: -0.17, roof: 'gable', color: 'wood' },
      { name: 'Changing rooms', x: 74, z: 70, width: 12, depth: 12, height: 3.5, heading: 0, roof: 'flat', color: 'grey' },
    ],
    areas: [
      { kind: 'watch', name: 'Watch area', outline: [{ x: -110, z: -84 }, { x: -121, z: -66 }, { x: -132, z: -41 }, { x: -139, z: -21 }, { x: -141, z: -3 }, { x: -137, z: 13 }, { x: -151, z: 17 }, { x: -155, z: -3 }, { x: -153, z: -22 }, { x: -146, z: -44 }, { x: -135, z: -69 }, { x: -123, z: -90 }] },
      { kind: 'parking', name: 'West parking', outline: [{ x: -196, z: -30 }, { x: -170, z: -30 }, { x: -170, z: -6 }, { x: -196, z: -6 }] },
      { kind: 'parking', name: 'South parking', outline: [{ x: -122, z: 48 }, { x: -100, z: 56 }, { x: -106, z: 70 }, { x: -128, z: 62 }] },
      { kind: 'field', name: 'North field west', outline: [{ x: -300, z: -128 }, { x: -8, z: -124 }, { x: -8, z: -260 }, { x: -300, z: -260 }] },
      { kind: 'field', name: 'North field east', outline: [{ x: 12, z: -124 }, { x: 300, z: -130 }, { x: 300, z: -260 }, { x: 12, z: -260 }] },
      { kind: 'pond', name: 'Small pond', outline: [{ x: 111, z: -88 }, { x: 108.4, z: -83.1 }, { x: 102, z: -81 }, { x: 95.6, z: -83.1 }, { x: 93, z: -88 }, { x: 95.6, z: -92.9 }, { x: 102, z: -95 }, { x: 108.4, z: -92.9 }] },
    ],
    roads: [
      { name: 'Access road', width: 6, points: [{ x: -210, z: -18 }, { x: -196, z: -18 }, { x: -180, z: 20 }, { x: -150, z: 52 }, { x: -115, z: 78 }, { x: -60, z: 90 }, { x: 0, z: 92 }] },
      { name: 'Field road', width: 5, points: [{ x: -300, z: -118 }, { x: -100, z: -112 }, { x: 0, z: -114 }, { x: 150, z: -110 }, { x: 300, z: -116 }] },
    ],
  },
};
