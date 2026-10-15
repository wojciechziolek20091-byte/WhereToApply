/**
 * Dusk palette for the Babylon scene, matching roblox/src/shared/DuskLighting.luau:
 * purple-to-pink sky, warm sun low on the horizon, light haze, pastel spray.
 * Colours are linear-ish 0..1 RGB.
 */
type RGB = [number, number, number];
const rgb = (r: number, g: number, b: number): RGB => [r / 255, g / 255, b / 255];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Sky stops from the horizon (0) to straight up (1). */
const SKY: [number, RGB][] = [
  [0, rgb(255, 196, 150)], // warm glow at the horizon
  [0.08, rgb(246, 160, 172)], // pink band
  [0.25, rgb(196, 132, 186)], // pink-violet
  [0.55, rgb(120, 92, 170)], // purple
  [1, rgb(62, 50, 120)], // deep violet overhead
];

export const DUSK = {
  skyGradient(t: number): RGB {
    for (let i = 1; i < SKY.length; i++) {
      const [t1, c1] = SKY[i]!;
      const [t0, c0] = SKY[i - 1]!;
      if (t <= t1) return mix(c0, c1, (t - t0) / (t1 - t0));
    }
    return SKY[SKY.length - 1]![1];
  },
  skyTop: rgb(62, 50, 120),
  fog: rgb(214, 150, 180), // pink haze
  fogDensity: 0.0042,
  ambient: rgb(120, 96, 150),
  skyLight: rgb(200, 170, 230), // purple-pink fill from above
  groundLight: rgb(110, 84, 140), // purple bounce from the water
  skyIntensity: 0.85,
  /** Toward the sun: low on the horizon. */
  sunDirection: [-0.55, 0.22, 0.8] as [number, number, number],
  sunColor: rgb(255, 196, 150),
  sunIntensity: 1.35,
  sunDisc: rgb(255, 214, 160),
  water: rgb(112, 120, 200), // blue with a violet cast
  waterSpecular: rgb(150, 110, 90), // warm sun glints
  tower: rgb(92, 82, 112),
  towerTop: rgb(70, 62, 90),
  cable: rgb(40, 34, 56),
  rope: rgb(30, 26, 40),
  carrier: rgb(255, 186, 60),
  box: rgb(214, 196, 168),
  rail: rgb(150, 142, 160),
  ramp: (t: number): RGB => mix(rgb(226, 206, 176), rgb(196, 172, 150), t),
  rock: (t: number): RGB => mix(rgb(96, 74, 120), rgb(156, 112, 150), t),
  sprayA: rgb(255, 250, 252),
  sprayB: rgb(255, 196, 214),
  sprayDead: rgb(196, 176, 240),
};
