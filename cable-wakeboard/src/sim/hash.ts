import type { SimState } from './world';

/** FNV-1a over a string, as 8 hex chars. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Hash of everything that evolves in a sim: tick, carrier and rider. Config,
 * cable path and features are fixed inputs and left out. Two sims with the
 * same config and the same input sequence must produce the same hash.
 */
export const hashSim = (s: SimState): string =>
  fnv1a(JSON.stringify({ tick: s.tick, carrier: s.carrier, rider: s.rider }));
