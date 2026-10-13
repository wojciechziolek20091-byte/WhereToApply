import type { AirState, FallKind, TakeoffSource } from './rider';

/** Emitted by stepSim(). The session and renderer read these; physics ignores them. */
export type SimEvent =
  | { type: 'takeoff'; tick: number; source: TakeoffSource; popSpeed: number; popQuality: number }
  | { type: 'landed'; tick: number; air: AirState; impact: number }
  | { type: 'fall'; tick: number; kind: FallKind; air: AirState | null }
  | { type: 'ropeSnap'; tick: number; stretchRate: number }
  | { type: 'featureEnter'; tick: number; featureId: string }
  | { type: 'featureExit'; tick: number; featureId: string }
  | {
      type: 'jibDone';
      tick: number;
      featureId: string;
      time: number;
      alignedTime: number;
      crossedTime: number;
    };
