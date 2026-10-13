/**
 * Seeded PRNG (mulberry32). The state is a plain number so it lives inside
 * serialisable sim state. Never use Math.random in the sim.
 */
export interface RngState {
  seed: number;
}

export const createRng = (seed: number): RngState => ({ seed: seed >>> 0 });

/** Next float in [0, 1). Mutates the state. */
export function nextFloat(rng: RngState): number {
  rng.seed = (rng.seed + 0x6d2b79f5) >>> 0;
  let t = rng.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Next float in [lo, hi). */
export const nextRange = (rng: RngState, lo: number, hi: number): number => lo + (hi - lo) * nextFloat(rng);
