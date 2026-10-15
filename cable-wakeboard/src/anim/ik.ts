import { type Quat, type V3, qconj, qfromBasis, qmul, vadd, vcross, vdot, vlen, vnorm, vscale, vsub } from './quat';

/**
 * Analytic two-bone IK (spec section 2.1: the rig has no IKControl, so this
 * is the solver for both games). `solveMiddle` finds the elbow or knee;
 * `chainRotations` turns the solved points into bone rotations that carry
 * the rest pose there without twisting the limb.
 */

/** Middle joint of a chain a -> c with bone lengths l1, l2, bending toward `pole` (a direction). */
export function solveMiddle(a: V3, c: V3, l1: number, l2: number, pole: V3): V3 {
  const ac = vsub(c, a);
  const len = vlen(ac);
  const d = Math.min(Math.max(len, Math.abs(l1 - l2) + 1e-4), l1 + l2 - 1e-5);
  const dir = len > 1e-9 ? vscale(ac, 1 / len) : { x: 0, y: -1, z: 0 };
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  let p = vsub(pole, vscale(dir, vdot(pole, dir)));
  if (vlen(p) < 1e-6) p = vcross(dir, { x: 1, y: 0, z: 0 });
  p = vnorm(p);
  return vadd(vadd(a, vscale(dir, along)), vscale(p, h));
}

function frame(dir: V3, normal: V3): Quat {
  const x = vnorm(dir);
  let n = vsub(normal, vscale(x, vdot(normal, x)));
  if (vlen(n) < 1e-6) n = vcross(x, { x: 0, y: 0, z: 1 });
  if (vlen(n) < 1e-6) n = vcross(x, { x: 0, y: 1, z: 0 });
  const y = vnorm(n);
  return qfromBasis(x, y, vcross(x, y));
}

/** Bend-plane normal of a chain, with `pole` as the fallback when it is straight. */
export function bendNormal(a: V3, b: V3, c: V3, pole: V3): V3 {
  const n = vcross(vsub(b, a), vsub(c, b));
  if (vlen(n) > 1e-6) return vnorm(n);
  return vnorm(vcross(vsub(c, a), pole));
}

/**
 * Root-frame rotations of the upper and lower bones that move the rest
 * chain (ra, rb, rc) onto (a, b, c). Rest bones have identity rotation.
 */
export function chainRotations(ra: V3, rb: V3, rc: V3, a: V3, b: V3, c: V3, pole: V3, restPole: V3): { upper: Quat; lower: Quat } {
  const n0 = bendNormal(ra, rb, rc, restPole);
  const n1 = bendNormal(a, b, c, pole);
  const upper = qmul(frame(vsub(b, a), n1), qconj(frame(vsub(rb, ra), n0)));
  const lower = qmul(frame(vsub(c, b), n1), qconj(frame(vsub(rc, rb), n0)));
  return { upper, lower };
}
