import { CH, NCH } from './channels';
import { JOINTS } from './skeleton';

/**
 * Pose clips (spec section 1.2): keys at normalised time t in [0, 1], each
 * setting some channels. Sampled with cubic Hermite curves through the keys
 * (Catmull-Rom tangents, flat at the ends), never linearly. A key's `ease`
 * shapes the segment that starts at it.
 */
export type JointRot = { x?: number; y?: number; z?: number };
export type EaseName = 'smooth' | 'in' | 'out' | 'linear';

export interface PoseKey {
  t: number;
  joints?: { [joint: string]: JointRot };
  /** Pelvis offset (m), root frame. */
  pelvis?: JointRot;
  /** Knee bend (deg), both legs, or [lead, back]. */
  knee?: number | [number, number];
  handle?: JointRot;
  tuck?: number;
  board?: JointRot;
  aim?: number;
  ease?: EaseName;
}

export interface PoseClip {
  name: string;
  keys: PoseKey[];
  loop?: boolean;
}

/** Per-channel key tracks, ready to sample. */
export interface CompiledClip {
  name: string;
  loop: boolean;
  /** Channel index -> its keys (t, value, ease of the segment starting there). */
  tracks: { ch: number; t: number[]; v: number[]; ease: EaseName[] }[];
  /** 1 for the channels this clip drives, else 0. */
  mask: number[];
}

function keyChannels(k: PoseKey): [number, number][] {
  const out: [number, number][] = [];
  const put = (name: string, v: number | undefined) => {
    if (v !== undefined) out.push([CH[name]!, v]);
  };
  for (const j of JOINTS) {
    const r = k.joints?.[j];
    if (r) {
      put(`${j}.x`, r.x);
      put(`${j}.y`, r.y);
      put(`${j}.z`, r.z);
    }
  }
  for (const g of ['pelvis', 'handle', 'board'] as const) {
    const r = k[g];
    if (r) {
      put(`${g}.x`, r.x);
      put(`${g}.y`, r.y);
      put(`${g}.z`, r.z);
    }
  }
  if (k.knee !== undefined) {
    const [a, b] = typeof k.knee === 'number' ? [k.knee, k.knee] : k.knee;
    put('kneeL', a);
    put('kneeR', b);
  }
  put('tuck', k.tuck);
  put('aim', k.aim);
  return out;
}

export function compileClip(clip: PoseClip): CompiledClip {
  const byCh = new Map<number, { t: number[]; v: number[]; ease: EaseName[] }>();
  const keys = [...clip.keys].sort((a, b) => a.t - b.t);
  for (const k of keys) {
    for (const [ch, v] of keyChannels(k)) {
      let tr = byCh.get(ch);
      if (!tr) {
        tr = { t: [], v: [], ease: [] };
        byCh.set(ch, tr);
      }
      tr.t.push(k.t);
      tr.v.push(v);
      tr.ease.push(k.ease ?? 'smooth');
    }
  }
  const mask = new Array<number>(NCH).fill(0);
  const tracks: CompiledClip['tracks'] = [];
  [...byCh.keys()].sort((a, b) => a - b).forEach((ch) => {
    const tr = byCh.get(ch)!;
    mask[ch] = 1;
    tracks.push({ ch, t: tr.t, v: tr.v, ease: tr.ease });
  });
  return { name: clip.name, loop: !!clip.loop, tracks, mask };
}

function shape(s: number, e: EaseName): number {
  if (e === 'in') return s * s;
  if (e === 'out') return 1 - (1 - s) * (1 - s);
  return s;
}

/** Hermite sample of one track at t. */
export function sampleTrack(t: number[], v: number[], ease: EaseName[], u: number): number {
  const n = t.length;
  if (n === 1 || u <= t[0]!) return v[0]!;
  if (u >= t[n - 1]!) return v[n - 1]!;
  let i = 0;
  while (i < n - 2 && u > t[i + 1]!) i++;
  const t0 = t[i]!, t1 = t[i + 1]!;
  const h = t1 - t0;
  const s = shape(h > 0 ? (u - t0) / h : 1, ease[i]!);
  const p0 = v[i]!, p1 = v[i + 1]!;
  // Catmull-Rom tangents (per unit of t), flat at the first and last key.
  const m0 = i > 0 ? ((p1 - v[i - 1]!) / (t1 - t[i - 1]!)) * h : 0;
  const m1 = i + 2 < n ? ((v[i + 2]! - p0) / (t[i + 2]! - t0)) * h : 0;
  const s2 = s * s, s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * p0 + (s3 - 2 * s2 + s) * m0 + (-2 * s3 + 3 * s2) * p1 + (s3 - s2) * m1;
}

/** Write the clip's channels at time u into `out` (other channels untouched). */
export function sampleClip(c: CompiledClip, u: number, out: number[]): void {
  let t = u;
  if (c.loop) t = t - Math.floor(t);
  for (const tr of c.tracks) out[tr.ch] = sampleTrack(tr.t, tr.v, tr.ease, t);
}
