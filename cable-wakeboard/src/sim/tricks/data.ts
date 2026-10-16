/**
 * Trick registry: names and base points, as data. classify.ts builds trick
 * names and points from what physics reported; scoring/combo.ts chains them.
 * Add a trick by adding a row here and a token where physics detects it.
 */

export type GrabId = 'indy' | 'stalefish' | 'nose' | 'tail';

export const GRABS: Record<GrabId, { id: GrabId; name: string }> = {
  indy: { id: 'indy', name: 'Indy' },
  stalefish: { id: 'stalefish', name: 'Stalefish' },
  nose: { id: 'nose', name: 'Nose' },
  tail: { id: 'tail', name: 'Tail' },
};

/** Inverts and the raley. `kind` is how physics produced it. */
export type InvertId = 'tantrum' | 'frontFlip' | 'backroll' | 'frontroll' | 'sBend' | 'raley';

export interface InvertDef {
  id: InvertId;
  name: string;
  points: number;
  /** Counts as an invert (head below the board). The raley does not. */
  invert: boolean;
}

export const INVERTS: Record<InvertId, InvertDef> = {
  raley: { id: 'raley', name: 'Raley', points: 300, invert: false },
  tantrum: { id: 'tantrum', name: 'Tantrum', points: 400, invert: true },
  frontFlip: { id: 'frontFlip', name: 'Front Flip', points: 400, invert: true },
  backroll: { id: 'backroll', name: 'Backroll', points: 450, invert: true },
  frontroll: { id: 'frontroll', name: 'Frontroll', points: 450, invert: true },
  sBend: { id: 'sBend', name: 'S-Bend', points: 600, invert: true },
};

/** Slides on a box or rail, named by the board's angle to the feature (the game's own naming). */
export type SlideId = 'fiftyFifty' | 'switchFiftyFifty' | 'backboard' | 'frontboard' | 'wallRide';

export const SLIDES: Record<SlideId, { id: SlideId; name: string; pointsPerSecond: number }> = {
  fiftyFifty: { id: 'fiftyFifty', name: '50-50', pointsPerSecond: 80 },
  switchFiftyFifty: { id: 'switchFiftyFifty', name: 'Switch 50-50', pointsPerSecond: 80 },
  backboard: { id: 'backboard', name: 'Backboard', pointsPerSecond: 120 },
  frontboard: { id: 'frontboard', name: 'Frontboard', pointsPerSecond: 120 },
  /** Riding up a wall ride's transition onto the wall (wake park features). */
  wallRide: { id: 'wallRide', name: 'Wall Ride', pointsPerSecond: 150 },
};

/** Base points (spec section 11.4). */
export const POINTS = {
  ollie: 50,
  spinPer180: 150,
  /** Backside spins need a handle pass, so they score more. */
  backsideSpinFactor: 1.2,
  handlePass: 100,
  /** Extra on an invert with at least a 360 spin (a Mobe). */
  mobeBonus: 350,
  grabPerInterval: 60,
  grabInterval: 0.25,
  grabMaxIntervals: 4,
  toBlind: 150,
  blindOut: 200,
  popOn: 150,
} as const;
