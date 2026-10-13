/** Trick catalogue. Data only: the classifier reads these tables. */

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
