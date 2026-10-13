/**
 * Trick catalogue. Data only: classify.ts reads these tables. Add a trick by
 * adding a row. Difficulty is in arbitrary points; scoring normalises it.
 */
import type { Approach, TakeoffSource } from '../rider';

export type GrabId = 'indy' | 'melon' | 'mute' | 'stalefish' | 'nose' | 'tail';

export interface GrabDef {
  id: GrabId;
  name: string;
  difficulty: number;
}

export const GRABS: Record<GrabId, GrabDef> = {
  indy: { id: 'indy', name: 'Indy', difficulty: 0.3 },
  melon: { id: 'melon', name: 'Melon', difficulty: 0.3 },
  mute: { id: 'mute', name: 'Mute', difficulty: 0.35 },
  stalefish: { id: 'stalefish', name: 'Stalefish', difficulty: 0.4 },
  nose: { id: 'nose', name: 'Nose', difficulty: 0.35 },
  tail: { id: 'tail', name: 'Tail', difficulty: 0.3 },
};

/** Straight jumps. Backside = heelside approach, frontside = toeside approach. */
export interface JumpDef {
  id: string;
  source: TakeoffSource;
  approach: Approach;
  name: string;
  difficulty: number;
}

const jumpName = (approach: Approach, what: string): string =>
  `${approach === 'heelside' ? 'Backside' : approach === 'toeside' ? 'Frontside' : 'Straight'} ${what}`;

const SOURCES: { source: TakeoffSource; what: string; difficulty: number }[] = [
  { source: 'kicker', what: 'Kicker Air', difficulty: 0.5 },
  { source: 'flat', what: 'Air Trick', difficulty: 0.8 },
  { source: 'slider', what: 'Ollie Off', difficulty: 0.4 },
  { source: 'lineLift', what: 'Line Lift', difficulty: 0.3 },
];
const APPROACHES: Approach[] = ['heelside', 'toeside', 'neutral'];

export const JUMPS: JumpDef[] = SOURCES.flatMap(({ source, what, difficulty }) =>
  APPROACHES.map((approach) => ({
    id: `${source}-${approach}`,
    source,
    approach,
    name: jumpName(approach, what),
    // A toeside approach is harder to load than heelside.
    difficulty: difficulty + (approach === 'toeside' ? 0.2 : approach === 'heelside' ? 0.1 : 0),
  })),
);

export interface SpinDef {
  degrees: number;
  difficulty: number;
}

/** Rotation count is the main difficulty driver for spins. */
export const SPINS: SpinDef[] = [
  { degrees: 180, difficulty: 1.0 },
  { degrees: 360, difficulty: 2.0 },
  { degrees: 540, difficulty: 3.2 },
  { degrees: 720, difficulty: 4.5 },
  { degrees: 900, difficulty: 6.0 },
];

export type InvertDirection = 'back' | 'front';
export type InvertAxis = 'flip' | 'roll';

/** Inverts: the head becomes the lowest point. The six basics. */
export interface InvertDef {
  id: string;
  name: string;
  approach: 'heelside' | 'toeside';
  direction: InvertDirection;
  axis: InvertAxis;
  difficulty: number;
}

export const INVERTS: InvertDef[] = [
  { id: 'tantrum', name: 'Tantrum', approach: 'heelside', direction: 'back', axis: 'flip', difficulty: 3.0 },
  { id: 'hs-backroll', name: 'Heelside Backroll', approach: 'heelside', direction: 'back', axis: 'roll', difficulty: 3.0 },
  { id: 'hs-frontflip', name: 'Heelside Frontflip', approach: 'heelside', direction: 'front', axis: 'flip', difficulty: 4.0 },
  { id: 'ts-backroll', name: 'Toeside Backroll', approach: 'toeside', direction: 'back', axis: 'roll', difficulty: 3.5 },
  { id: 'ts-frontflip', name: 'Toeside Frontflip', approach: 'toeside', direction: 'front', axis: 'flip', difficulty: 4.2 },
  { id: 'frontroll', name: 'Frontroll', approach: 'toeside', direction: 'front', axis: 'roll', difficulty: 3.5 },
];

/** Raleys: body swings up above the board on rope tension. */
export interface RaleyDef {
  id: string;
  name: string;
  approach: 'heelside' | 'toeside';
  difficulty: number;
}

export const RALEYS: RaleyDef[] = [
  { id: 'raley', name: 'Raley', approach: 'heelside', difficulty: 3.0 },
  { id: 'ts-raley', name: 'Toeside Raley', approach: 'toeside', difficulty: 3.5 },
];

/** Named combinations of a base trick and a spin. */
export interface ComboDef {
  id: string;
  name: string;
  /** Id of the base invert or raley. */
  base: string;
  spinDegrees: number;
  spinDirection: 'frontside' | 'backside';
  difficulty: number;
}

export const COMBOS: ComboDef[] = [
  { id: 'scarecrow', name: 'Scarecrow', base: 'frontroll', spinDegrees: 180, spinDirection: 'frontside', difficulty: 5.0 },
  { id: 'tantrum-to-blind', name: 'Tantrum to Blind', base: 'tantrum', spinDegrees: 180, spinDirection: 'backside', difficulty: 4.6 },
];

/** Jib tricks on boxes and rails. */
export interface JibDef {
  id: string;
  name: string;
  difficulty: number;
}

export const JIBS: Record<'fiftyFifty' | 'boardslide', JibDef> = {
  fiftyFifty: { id: '50-50', name: '50-50', difficulty: 0.6 },
  boardslide: { id: 'boardslide', name: 'Boardslide', difficulty: 1.0 },
};

/** Multipliers applied on top of base difficulty. */
export const MODIFIERS = {
  switch: 0.15,
  blind: 0.1,
  combo: 0.2,
} as const;
