import { type Quat, qslerp, type V3 } from './quat';
import type { AnimRiderMode, GrabName, RiderAnimState, SlideName, TrickId } from './state';

/**
 * Replication (spec section 12): other players never get joints. Each client
 * sends its rider's anim state as a flat number list at 15-20 Hz over an
 * unreliable RemoteEvent; the others rebuild a RiderAnimState from it,
 * interpolate between packets, and run the same animator. One-shot flags
 * (landed, popped, rope snap) are held until the next send so none is lost.
 * Twin: Anim/AnimReplication.luau.
 */
const STATES: AnimRiderMode[] = ['Riding', 'RidingBlind', 'WaterTrickLoad', 'WaterTrickAir', 'Airborne', 'OnSafety', 'OnFeature', 'Landing', 'Crashed'];
const TRICKS: (TrickId | null)[] = [null, 'Ollie', 'Spin', 'FrontFlip', 'Tantrum', 'Raley', 'Backroll', 'Frontroll', 'SBendL', 'SBendR', 'Mobe'];
const GRABS: (GrabName | null)[] = [null, 'Indy', 'Stalefish', 'Nose', 'Tail'];
const HANDLES: RiderAnimState['handle'][] = ['InFront', 'Behind', 'Passing', 'Dropped'];
const SLIDES: (SlideName | null)[] = [null, 'FiftyFifty', 'Backboard', 'Frontboard', 'SwitchFiftyFifty', 'WallRide'];
const SIDES: RiderAnimState['trick']['spinDirection'][] = [null, 'Frontside', 'Backside'];
const QUALITIES: ('Clean' | 'Sketchy' | null)[] = [null, 'Clean', 'Sketchy'];
const ROLLS: RiderAnimState['ext']['rollKind'][] = [null, 'back', 'front'];
const CRASHES = [
  '',
  'shortOllie',
  'missedSafetyPop',
  'handleDropped',
  'underRotated',
  'overRotated',
  'grabHeldOnLanding',
  'raleyExtendedOnLanding',
  'caughtEdgeBlind',
  'fellOffFeature',
  'ropeYank',
  'badLandingYaw',
  'hardLanding',
  'hitFeature',
  'letGo',
  'clippedSide',
  'noseHitSide',
  'overshoot',
  'slippedOut',
  'badAngle',
  'landedInGap',
  'stalled',
  'kinkThrow',
  'ranOutMidRotation',
];

export const PACKET_LENGTH = 50;
export const SEND_RATE = 18;

const idx = <T>(list: T[], v: T): number => Math.max(0, list.indexOf(v));

/** Encode a state (time in seconds). `flags` are the one-shots seen since the last send. */
export function packAnimState(s: RiderAnimState, time: number, flags: number): number[] {
  const b = s.boardCFrame;
  return [
    time,
    idx(STATES, s.state),
    idx(TRICKS, s.trick.id),
    s.trick.phase,
    s.trick.spinDegrees,
    s.trick.flipDegrees,
    s.edge,
    s.tension,
    idx(HANDLES, s.handle),
    idx(GRABS, s.trick.grab),
    s.trick.grabTime,
    b.pos.x,
    b.pos.y,
    b.pos.z,
    b.rot.x,
    b.rot.y,
    b.rot.z,
    b.rot.w,
    s.velocity.x,
    s.velocity.y,
    s.velocity.z,
    s.ext.carrier.x,
    s.ext.carrier.y,
    s.ext.carrier.z,
    s.ext.toes,
    s.popCharge,
    s.ext.spinRate,
    s.ext.spinRemaining,
    s.ext.flipRemaining,
    s.ext.extension,
    s.ext.rollDegrees,
    s.ext.sBend,
    idx(ROLLS, s.ext.rollKind),
    s.ext.edgeDegrees,
    s.ext.slope,
    idx(SLIDES, s.feature?.slide ?? null),
    s.feature ? s.feature.balance : 0,
    s.ext.featureTurn,
    idx(CRASHES, s.crashReason ?? ''),
    s.ext.modeTime,
    s.ext.airTime,
    s.ext.airDuration,
    flags,
    s.landing ? s.landing.impactSpeed : 0,
    s.landing ? idx(QUALITIES, s.landing.quality) : -1,
    idx(SIDES, s.trick.spinDirection),
    s.ext.preWind,
    s.passProgress ?? -1,
    s.speed,
    s.feature ? 1 : 0,
  ];
}

/** One-shot flags of a state, to OR together between sends. */
export const stateFlags = (s: RiderAnimState): number => (s.ext.justLanded ? 1 : 0) + (s.ext.justTookOff ? 2 : 0) + (s.ext.ropeSnap ? 4 : 0);

export function unpackAnimState(p: number[]): RiderAnimState {
  const n = (i: number): number => p[i] ?? 0;
  const v = (i: number): V3 => ({ x: n(i), y: n(i + 1), z: n(i + 2) });
  const flags = n(42);
  const landingQ = n(44);
  return {
    state: STATES[n(1)] ?? 'Riding',
    stance: n(24) >= 0 ? 'Regular' : 'Goofy',
    isSwitch: false,
    speed: n(48),
    velocity: v(18),
    edge: n(6),
    tension: n(7),
    popCharge: n(25),
    boardCFrame: { pos: v(11), rot: { x: n(14), y: n(15), z: n(16), w: n(17) } },
    handlePosition: v(11),
    trick: {
      id: TRICKS[n(2)] ?? null,
      phase: n(3),
      spinDegrees: n(4),
      spinDirection: SIDES[n(45)] ?? null,
      flipDegrees: n(5),
      grab: GRABS[n(9)] ?? null,
      grabTime: n(10),
    },
    handle: HANDLES[n(8)] ?? 'InFront',
    passProgress: n(47) >= 0 ? n(47) : null,
    feature: n(49) > 0 ? { slide: SLIDES[n(35)] ?? null, balance: n(36) } : null,
    landing: landingQ >= 0 ? { impactSpeed: n(43), quality: QUALITIES[landingQ] ?? null } : null,
    crashReason: n(38) > 0 ? (CRASHES[n(38)] ?? null) : null,
    ext: {
      toes: n(24) >= 0 ? 1 : -1,
      carrier: v(21),
      airTime: n(40),
      airDuration: n(41),
      spinRate: n(26),
      spinRemaining: n(27),
      flipRemaining: n(28),
      preWind: n(46),
      extension: n(29),
      rollDegrees: n(30),
      sBend: n(31),
      rollKind: ROLLS[n(32)] ?? null,
      edgeDegrees: n(33),
      slope: n(34),
      rail: false,
      featureTurn: n(37),
      lipPop: false,
      modeTime: n(39),
      justLanded: (flags & 1) !== 0,
      justTookOff: (flags & 2) !== 0,
      ropeSnap: (flags & 4) !== 0,
      spinOut: 0,
    },
  };
}

/** Indices of the numbers that interpolate linearly (the rest take the newer packet). */
const LERP = [3, 4, 5, 6, 7, 10, 11, 12, 13, 18, 19, 20, 21, 22, 23, 25, 26, 27, 28, 29, 30, 33, 34, 36, 37, 39, 40, 41, 46, 48];

/** Received packets of one remote rider, oldest first, and the newest packet whose one-shots have fired. */
export interface RemoteBuffer {
  packets: number[][];
  flagsFiredAt: number;
}

export const createRemoteBuffer = (): RemoteBuffer => ({ packets: [], flagsFiredAt: -1 });

/** Add a packet; keeps the last second or so. */
export function pushPacket(buf: RemoteBuffer, p: number[]): void {
  const last = buf.packets[buf.packets.length - 1];
  if (last && p[0]! <= last[0]!) return;
  buf.packets.push(p);
  while (buf.packets.length > 24) buf.packets.shift();
}

/**
 * A remote rider's state at `time` (render a little behind the newest
 * packet, e.g. 0.1 s), interpolated between the two packets around it.
 */
export function sampleRemote(buf: RemoteBuffer, time: number): RiderAnimState | null {
  const packets = buf.packets;
  if (packets.length === 0) return null;
  let i = packets.length - 1;
  while (i > 0 && packets[i - 1]![0]! > time) i--;
  const b = packets[i]!;
  const a = i > 0 ? packets[i - 1]! : b;
  const ta = a[0]!, tb = b[0]!;
  const t = tb > ta ? Math.max(0, Math.min(1, (time - ta) / (tb - ta))) : 1;
  const sameMode = a[1] === b[1] && a[2] === b[2];
  const out = b.slice();
  if (sameMode) for (const k of LERP) out[k] = a[k]! + (b[k]! - a[k]!) * t;
  else for (const k of [11, 12, 13, 21, 22, 23]) out[k] = a[k]! + (b[k]! - a[k]!) * t;
  const qa: Quat = { x: a[14]!, y: a[15]!, z: a[16]!, w: a[17]! };
  const qb: Quat = { x: b[14]!, y: b[15]!, z: b[16]!, w: b[17]! };
  const q = qslerp(qa, qb, t);
  out[14] = q.x;
  out[15] = q.y;
  out[16] = q.z;
  out[17] = q.w;
  // One-shots fire once, on the first frame that reaches the packet that carried them.
  if (tb > buf.flagsFiredAt && time >= ta) buf.flagsFiredAt = tb;
  else out[42] = 0;
  return unpackAnimState(out);
}
