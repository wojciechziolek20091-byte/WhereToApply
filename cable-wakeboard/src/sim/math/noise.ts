import { createRng, nextFloat } from './rng';

/** Deterministic hash of an integer to [0, 1), via one mulberry32 draw. */
export const hashUnit = (n: number): number => nextFloat(createRng(n));

/**
 * Smooth 1D value noise in [-1, 1]: random values at whole numbers of `t`,
 * blended with a smoothstep. `seed` picks an independent stream. Built only
 * from + - * / and floor, so the Luau port gives the same bits.
 */
export function valueNoise(t: number, seed: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const a = hashUnit(i + seed * 7919);
  const b = hashUnit(i + 1 + seed * 7919);
  const w = f * f * (3 - 2 * f);
  return (a + (b - a) * w) * 2 - 1;
}
