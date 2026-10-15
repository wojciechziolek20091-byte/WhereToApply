/**
 * Quaternions and small vector helpers for the animation system. Plain
 * `{x, y, z, w}` tables so the Luau twin (Anim/Quat.luau) is a line-by-line
 * copy. Right-handed, rotations act on column vectors: rotate(q, v) = q v q*.
 */

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}
export interface V3 {
  x: number;
  y: number;
  z: number;
}

export const DEG = Math.PI / 180;

export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
export const vadd = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const vsub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const vscale = (a: V3, k: number): V3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
export const vdot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const vcross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const vlen = (a: V3): number => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
export const vlerp = (a: V3, b: V3, t: number): V3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
export function vnorm(a: V3): V3 {
  const l = vlen(a);
  return l > 1e-9 ? { x: a.x / l, y: a.y / l, z: a.z / l } : { x: 0, y: 0, z: 0 };
}

export const qid = (): Quat => ({ x: 0, y: 0, z: 0, w: 1 });

export function qmul(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

export const qconj = (q: Quat): Quat => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });

export function qnorm(q: Quat): Quat {
  const l = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
  return l > 1e-12 ? { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l } : qid();
}

/** Rotation of `angle` rad about unit `axis`. */
export function qaxis(axis: V3, angle: number): Quat {
  const s = Math.sin(angle / 2);
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(angle / 2) };
}

export function qrot(q: Quat, v: V3): V3 {
  // v' = v + 2w (u x v) + 2 u x (u x v), u = (x, y, z)
  const u = { x: q.x, y: q.y, z: q.z };
  const t = vscale(vcross(u, v), 2);
  return vadd(vadd(v, vscale(t, q.w)), vcross(u, t));
}

/**
 * Joint rotation from degrees, applied yaw (Y) then pitch (X) then roll (Z)
 * in the parent's frame: q = Y * X * Z. Rider frame: +x along the board toward
 * the nose (the rider's lead side), +y up, +z toward the toes (the chest).
 * +x tips a bone's top toward the toes (forward), +y turns it to the left seen
 * from above (counter-clockwise), +z rolls its top toward -x (the back foot).
 */
export function qeuler(xDeg: number, yDeg: number, zDeg: number): Quat {
  const qx = qaxis({ x: 1, y: 0, z: 0 }, xDeg * DEG);
  const qy = qaxis({ x: 0, y: 1, z: 0 }, yDeg * DEG);
  const qz = qaxis({ x: 0, y: 0, z: 1 }, zDeg * DEG);
  return qmul(qy, qmul(qx, qz));
}

export function qslerp(a: Quat, b: Quat, t: number): Quat {
  let d = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  let bx = b.x, by = b.y, bz = b.z, bw = b.w;
  if (d < 0) {
    d = -d;
    bx = -bx; by = -by; bz = -bz; bw = -bw;
  }
  if (d > 0.9995) {
    return qnorm({ x: a.x + (bx - a.x) * t, y: a.y + (by - a.y) * t, z: a.z + (bz - a.z) * t, w: a.w + (bw - a.w) * t });
  }
  const th = Math.acos(d);
  const s = Math.sin(th);
  const ka = Math.sin((1 - t) * th) / s;
  const kb = Math.sin(t * th) / s;
  return { x: a.x * ka + bx * kb, y: a.y * ka + by * kb, z: a.z * ka + bz * kb, w: a.w * ka + bw * kb };
}

/** Shortest rotation taking unit `a` onto unit `b`. */
export function qfromTo(a: V3, b: V3): Quat {
  const d = vdot(a, b);
  if (d < -0.999999) {
    // Opposite: any axis perpendicular to a.
    let axis = vcross({ x: 1, y: 0, z: 0 }, a);
    if (vlen(axis) < 1e-6) axis = vcross({ x: 0, y: 1, z: 0 }, a);
    return qaxis(vnorm(axis), Math.PI);
  }
  const c = vcross(a, b);
  return qnorm({ x: c.x, y: c.y, z: c.z, w: 1 + d });
}

/**
 * Rotation whose local +y maps to `up` and whose local +z is as close as
 * possible to `fwd` (both world). Used to rebuild bone frames from points.
 */
export function qlook(up: V3, fwd: V3): Quat {
  const y = vnorm(up);
  let x = vcross(y, fwd);
  if (vlen(x) < 1e-6) x = vcross(y, { x: 0, y: 0, z: 1 });
  if (vlen(x) < 1e-6) x = vcross(y, { x: 1, y: 0, z: 0 });
  x = vnorm(x);
  const z = vcross(x, y);
  return qfromBasis(x, y, z);
}

/** Quaternion from orthonormal basis columns. */
export function qfromBasis(x: V3, y: V3, z: V3): Quat {
  const m00 = x.x, m01 = y.x, m02 = z.x;
  const m10 = x.y, m11 = y.y, m12 = z.y;
  const m20 = x.z, m21 = y.z, m22 = z.z;
  const tr = m00 + m11 + m22;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    return qnorm({ w: 0.25 * s, x: (m21 - m12) / s, y: (m02 - m20) / s, z: (m10 - m01) / s });
  }
  if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    return qnorm({ w: (m21 - m12) / s, x: 0.25 * s, y: (m01 + m10) / s, z: (m02 + m20) / s });
  }
  if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    return qnorm({ w: (m02 - m20) / s, x: (m01 + m10) / s, y: 0.25 * s, z: (m12 + m21) / s });
  }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return qnorm({ w: (m10 - m01) / s, x: (m02 + m20) / s, y: (m12 + m21) / s, z: 0.25 * s });
}

/** Angle of a rotation (rad, 0..PI). */
export function qangle(q: Quat): number {
  const w = Math.min(1, Math.abs(q.w));
  return 2 * Math.acos(w);
}

/** Mirror a rotation across the rider's x = 0 plane (swap lead and back sides). */
export const qmirrorX = (q: Quat): Quat => ({ x: q.x, y: -q.y, z: -q.z, w: q.w });
