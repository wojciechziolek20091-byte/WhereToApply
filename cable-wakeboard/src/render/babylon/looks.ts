/**
 * Lighting and colour presets for the Babylon scene. DAY is the default
 * (bright sky, turquoise rippled water, green shoreline); DUSK matches
 * roblox/src/shared/DuskLighting.luau. Colours are 0..1 RGB.
 */
export type RGB = [number, number, number];
const rgb = (r: number, g: number, b: number): RGB => [r / 255, g / 255, b / 255];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function gradient(stops: [number, RGB][]): (t: number) => RGB {
  return (t) => {
    for (let i = 1; i < stops.length; i++) {
      const [t1, c1] = stops[i]!;
      const [t0, c0] = stops[i - 1]!;
      if (t <= t1) return mix(c0, c1, (t - t0) / (t1 - t0));
    }
    return stops[stops.length - 1]![1];
  };
}

export interface Look {
  name: 'day' | 'dusk';
  /** Sky colour from the horizon (0) to straight up (1). */
  skyGradient: (t: number) => RGB;
  skyTop: RGB;
  fog: RGB;
  fogDensity: number;
  ambient: RGB;
  skyLight: RGB;
  groundLight: RGB;
  skyIntensity: number;
  /** Direction toward the sun. */
  sunDirection: [number, number, number];
  sunColor: RGB;
  sunIntensity: number;
  sunDisc: RGB;
  /** Draw a visible sun disc with glow. */
  showSun: boolean;
  water: RGB;
  waterSpecular: RGB;
  waterSpecularPower: number;
  /** Rippled, animated water (true) or static faceted water (false). */
  rippleWater: boolean;
  land: RGB;
  /** Mown grass around the buildings and tents. */
  lawn: RGB;
  beach: RGB;
  /** Wooden decks: starting dock, watch terrace. */
  deck: RGB;
  asphalt: RGB;
  road: RGB;
  field: (t: number) => RGB;
  walls: Record<'white' | 'cream' | 'grey' | 'wood', RGB>;
  roof: RGB;
  tent: RGB;
  /** Side panels of the floating kickers (white ramps with blue sides). */
  kickerSide: RGB;
  treeLeaves: (t: number) => RGB;
  treeTrunk: RGB;
  tower: RGB;
  towerTop: RGB;
  cable: RGB;
  rope: RGB;
  carrier: RGB;
  box: RGB;
  rail: RGB;
  ramp: (t: number) => RGB;
  rock: (t: number) => RGB;
  buoy: RGB;
  sprayA: RGB;
  sprayB: RGB;
  sprayDead: RGB;
  wake: RGB;
}

export const DAY: Look = {
  name: 'day',
  skyGradient: gradient([
    [0, rgb(206, 228, 242)], // pale haze at the horizon
    [0.12, rgb(156, 198, 236)],
    [0.45, rgb(104, 160, 224)],
    [1, rgb(70, 128, 208)], // deep blue overhead
  ]),
  skyTop: rgb(70, 128, 208),
  fog: rgb(196, 222, 240),
  fogDensity: 0.0026,
  ambient: rgb(150, 170, 190),
  skyLight: rgb(220, 236, 255),
  groundLight: rgb(90, 140, 150),
  skyIntensity: 0.9,
  sunDirection: [0.35, 0.75, 0.55],
  sunColor: rgb(255, 248, 236),
  sunIntensity: 1.25,
  sunDisc: rgb(255, 250, 235),
  showSun: false,
  water: rgb(28, 178, 200), // turquoise
  waterSpecular: rgb(255, 255, 255),
  waterSpecularPower: 90,
  rippleWater: true,
  land: rgb(62, 98, 54),
  lawn: rgb(98, 142, 66),
  beach: rgb(196, 186, 150),
  deck: rgb(196, 156, 108),
  asphalt: rgb(92, 96, 100),
  road: rgb(170, 160, 140),
  field: (t) => mix(rgb(128, 102, 74), rgb(160, 136, 96), t),
  walls: { white: rgb(238, 238, 234), cream: rgb(232, 224, 204), grey: rgb(176, 180, 184), wood: rgb(168, 124, 88) },
  roof: rgb(74, 78, 86),
  tent: rgb(248, 248, 246),
  kickerSide: rgb(36, 84, 176),
  treeLeaves: gradient([
    [0, rgb(32, 82, 40)],
    [0.5, rgb(52, 118, 50)],
    [1, rgb(96, 156, 62)],
  ]),
  treeTrunk: rgb(92, 70, 52),
  tower: rgb(150, 156, 162),
  towerTop: rgb(230, 196, 60),
  cable: rgb(40, 44, 50),
  rope: rgb(236, 210, 40), // yellow ropes
  carrier: rgb(236, 196, 50),
  box: rgb(234, 240, 242), // white features
  rail: rgb(40, 118, 214), // blue rails, as on the park map
  ramp: (t) => mix(rgb(240, 244, 246), rgb(214, 222, 228), t),
  rock: (t) => mix(rgb(110, 112, 104), rgb(150, 150, 140), t),
  buoy: rgb(244, 246, 248),
  sprayA: rgb(255, 255, 255),
  sprayB: rgb(236, 248, 252),
  sprayDead: rgb(255, 255, 255),
  wake: rgb(214, 244, 248), // pale foam lines
};

export const DUSK: Look = {
  name: 'dusk',
  skyGradient: gradient([
    [0, rgb(255, 196, 150)],
    [0.08, rgb(246, 160, 172)],
    [0.25, rgb(196, 132, 186)],
    [0.55, rgb(120, 92, 170)],
    [1, rgb(62, 50, 120)],
  ]),
  skyTop: rgb(62, 50, 120),
  fog: rgb(214, 150, 180),
  fogDensity: 0.0042,
  ambient: rgb(120, 96, 150),
  skyLight: rgb(200, 170, 230),
  groundLight: rgb(110, 84, 140),
  skyIntensity: 0.85,
  sunDirection: [-0.55, 0.22, 0.8],
  sunColor: rgb(255, 196, 150),
  sunIntensity: 1.35,
  sunDisc: rgb(255, 214, 160),
  showSun: true,
  water: rgb(112, 120, 200),
  waterSpecular: rgb(150, 110, 90),
  waterSpecularPower: 48,
  rippleWater: false,
  land: rgb(78, 62, 96),
  lawn: rgb(96, 78, 112),
  beach: rgb(150, 120, 140),
  deck: rgb(130, 96, 96),
  asphalt: rgb(70, 62, 86),
  road: rgb(140, 116, 132),
  field: (t) => mix(rgb(112, 84, 96), rgb(140, 108, 112), t),
  walls: { white: rgb(220, 200, 214), cream: rgb(214, 190, 186), grey: rgb(150, 136, 160), wood: rgb(150, 104, 100) },
  roof: rgb(64, 52, 84),
  tent: rgb(232, 214, 226),
  kickerSide: rgb(64, 70, 150),
  treeLeaves: gradient([
    [0, rgb(60, 56, 96)],
    [1, rgb(110, 90, 130)],
  ]),
  treeTrunk: rgb(60, 46, 64),
  tower: rgb(92, 82, 112),
  towerTop: rgb(70, 62, 90),
  cable: rgb(40, 34, 56),
  rope: rgb(30, 26, 40),
  carrier: rgb(255, 186, 60),
  box: rgb(214, 196, 168),
  rail: rgb(150, 142, 160),
  ramp: (t) => mix(rgb(226, 206, 176), rgb(196, 172, 150), t),
  rock: (t) => mix(rgb(96, 74, 120), rgb(156, 112, 150), t),
  buoy: rgb(230, 220, 236),
  sprayA: rgb(255, 250, 252),
  sprayB: rgb(255, 196, 214),
  sprayDead: rgb(196, 176, 240),
  wake: rgb(70, 76, 150),
};

export const LOOKS = { day: DAY, dusk: DUSK } as const;
