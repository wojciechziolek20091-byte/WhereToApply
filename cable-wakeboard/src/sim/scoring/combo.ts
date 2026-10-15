import type { ComboConfig } from '../config';

/**
 * Combo scoring (spec section 11.3), as pure functions so the Roblox server
 * can recompute a client's combo with the same code.
 *
 *   combo = sum(points x quality x repeat) x min(maxMultiplier, 1 + perTrick (n - 1)) x product(comboFactor)
 *
 * Repeating a trick name inside one combo scores that trick x repeatPenalty.
 */

/** What the scorer needs to know about one trick in a combo. */
export interface ComboEntry {
  name: string;
  points: number;
  quality: number;
  comboFactor: number;
}

export interface ComboScore {
  /** Points for each trick after quality and the repeat rule. */
  perTrick: number[];
  multiplier: number;
  total: number;
}

export function scoreCombo(entries: readonly ComboEntry[], cfg: ComboConfig): ComboScore {
  const seen: string[] = [];
  const perTrick: number[] = [];
  let sum = 0;
  let factor = 1;
  for (const e of entries) {
    const repeat = seen.includes(e.name) ? cfg.repeatPenalty : 1;
    seen.push(e.name);
    const p = e.points * e.quality * repeat;
    perTrick.push(p);
    sum += p;
    factor *= e.comboFactor;
  }
  const n = entries.length;
  const multiplier = n > 0 ? Math.min(cfg.maxMultiplier, 1 + cfg.perTrick * (n - 1)) * factor : 0;
  return { perTrick, multiplier, total: Math.round(sum * multiplier) };
}

/** A combo is the chain of tricks name, e.g. "Backside 360 Indy + Raley". */
export const comboName = (entries: readonly ComboEntry[]): string => entries.map((e) => e.name).join(' + ');
