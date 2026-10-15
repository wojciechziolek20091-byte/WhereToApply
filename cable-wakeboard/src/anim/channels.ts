import { JOINTS, type JointName, MIRROR } from './skeleton';

/**
 * A pose as a flat list of numbers ("channels"), so layers blend, add and
 * inertialize with plain arithmetic and the Luau copy stays simple:
 *
 * - `<Joint>.x/.y/.z`: the joint's rotation in degrees (quat.ts qeuler:
 *   +x tips the bone forward toward the toes, +y turns the chest toward the
 *   lead side, +z rolls the top toward the back foot). Arms only use these
 *   while a hand is free; held hands are placed by IK.
 * - `pelvis.*`: pelvis offset in the root frame (m), added after the knees set its height.
 * - `kneeL`, `kneeR`: knee bend of each leg (deg); they set the pelvis height.
 * - `handle.*`: offset of the handle's target from where the rope puts it (m).
 * - `tuck`: 0 open .. 1 tight (inverts; must match the sim's tuck curve).
 * - `board.*`: extra board rotation for tweaks (deg); the upper body is compensated.
 * - `aim`: how much head aim overrides the clip's neck (0..1).
 */
const extras = ['pelvis.x', 'pelvis.y', 'pelvis.z', 'kneeL', 'kneeR', 'handle.x', 'handle.y', 'handle.z', 'tuck', 'board.x', 'board.y', 'board.z', 'aim'];

export const CHANNELS: string[] = [];
for (const j of JOINTS) CHANNELS.push(`${j}.x`, `${j}.y`, `${j}.z`);
for (const e of extras) CHANNELS.push(e);

export const NCH = CHANNELS.length;

/** Channel name -> index. */
export const CH: Record<string, number> = {};
CHANNELS.forEach((c, i) => {
  CH[c] = i;
});

/** Index of a joint's x channel (y and z follow). */
export const jointCh = (j: JointName): number => CH[`${j}.x`]!;

export type ChannelPose = number[];

/** Value of each channel in a neutral pose. */
export function neutralPose(): ChannelPose {
  const p = new Array<number>(NCH).fill(0);
  p[CH.kneeL!] = 28;
  p[CH.kneeR!] = 28;
  p[CH.aim!] = 1;
  return p;
}

/**
 * Mirror table (spec 1.5): for every channel, which channel it reads from
 * and with which sign. Mirroring across the rider's x = 0 plane swaps L and
 * R, keeps x rotations and negates y and z rotations and x offsets.
 */
export const MIRROR_FROM: number[] = [];
export const MIRROR_SIGN: number[] = [];
for (const c of CHANNELS) {
  const [name, axis] = c.split('.') as [string, string | undefined];
  let from = c;
  let sign = 1;
  if ((JOINTS as readonly string[]).includes(name)) {
    from = `${MIRROR[name as JointName]}.${axis}`;
    sign = axis === 'x' ? 1 : -1;
  } else if (name === 'kneeL') from = 'kneeR';
  else if (name === 'kneeR') from = 'kneeL';
  else if (name === 'pelvis' || name === 'handle') sign = axis === 'x' ? -1 : 1;
  else if (name === 'board') sign = axis === 'x' ? 1 : -1;
  MIRROR_FROM.push(CH[from]!);
  MIRROR_SIGN.push(sign);
}

/** mirrorPose: the same pose for the other stance. Never author per-stance clips. */
export function mirrorPose(p: ChannelPose): ChannelPose {
  const out = new Array<number>(NCH);
  for (let i = 0; i < NCH; i++) out[i] = p[MIRROR_FROM[i]!]! * MIRROR_SIGN[i]!;
  return out;
}

/** out = a + (b - a) * w * mask, per channel. `mask` null means every channel. */
export function blendInto(a: ChannelPose, b: ChannelPose, w: number, mask: number[] | null): void {
  if (w <= 0) return;
  for (let i = 0; i < NCH; i++) {
    const m = mask ? mask[i]! * w : w;
    if (m > 0) a[i] = a[i]! + (b[i]! - a[i]!) * m;
  }
}

/** a += b * w * mask (additive layers). */
export function addInto(a: ChannelPose, b: ChannelPose, w: number, mask: number[] | null): void {
  if (w === 0) return;
  for (let i = 0; i < NCH; i++) {
    const m = mask ? mask[i]! * w : w;
    if (m !== 0) a[i] = a[i]! + b[i]! * m;
  }
}
