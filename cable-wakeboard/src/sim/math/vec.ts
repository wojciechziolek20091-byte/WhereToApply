/** Plain 3D vector. Immutable helpers: every function returns a new vector. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const ZERO: Readonly<Vec3> = Object.freeze(vec3());
export const UP: Readonly<Vec3> = Object.freeze(vec3(0, 1, 0));

export const add = (a: Vec3, b: Vec3): Vec3 => vec3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vec3, b: Vec3): Vec3 => vec3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a: Vec3, s: number): Vec3 => vec3(a.x * s, a.y * s, a.z * s);
export const addScaled = (a: Vec3, b: Vec3, s: number): Vec3 =>
  vec3(a.x + b.x * s, a.y + b.y * s, a.z + b.z * s);
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 =>
  vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const distance = (a: Vec3, b: Vec3): number => length(sub(a, b));
export const normalize = (a: Vec3): Vec3 => {
  const l = length(a);
  return l > 1e-12 ? scale(a, 1 / l) : vec3();
};
export const lerpVec = (a: Vec3, b: Vec3, t: number): Vec3 =>
  vec3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);

/** Horizontal (x-z) part of a vector. */
export const horizontal = (a: Vec3): Vec3 => vec3(a.x, 0, a.z);
export const horizontalLength = (a: Vec3): number => Math.hypot(a.x, a.z);

/** Unit forward vector for a heading psi: (cos psi, 0, sin psi). */
export const forwardOf = (psi: number): Vec3 => vec3(Math.cos(psi), 0, Math.sin(psi));
/** Unit vector to the right of heading psi, seen from above with +y up. */
export const rightOf = (psi: number): Vec3 => vec3(-Math.sin(psi), 0, Math.cos(psi));
/** Heading angle of the horizontal part of a vector. */
export const headingOf = (a: Vec3): number => Math.atan2(a.z, a.x);
