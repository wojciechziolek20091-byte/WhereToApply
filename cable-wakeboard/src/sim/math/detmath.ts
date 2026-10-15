/**
 * Deterministic sin, cos, tan, atan2, log, exp and pow built from + - * / and
 * floor only (fdlibm kernels, Cody-Waite reduction). Math.sin and friends differ in the
 * last bit between JavaScript engines and C libraries, which would split the
 * TypeScript and Luau sims apart within seconds; these give the same bits
 * everywhere. Mirrored line for line by roblox/src/shared/Sim/DetMath.luau.
 * Accurate to about 1 ulp for the angles the sim uses (|x| < 1e5).
 */

const INV_PIO2 = 6.36619772367581382433e-1;
const PIO2_1 = 1.57079632673412561417e0;
const PIO2_2 = 6.07710050630396597660e-11;
const PIO2_2T = 2.02226624879595063154e-21;

const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;

const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.08757232129817482790e-9;
const C6 = -1.13596475577881948265e-11;

/** sin on [-pi/4, pi/4]. */
function kernelSin(x: number): number {
  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  return x + v * (S1 + z * r);
}

/** cos on [-pi/4, pi/4]. */
function kernelCos(x: number): number {
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  const hz = 0.5 * z;
  const w = 1 - hz;
  return w + ((1 - w - hz) + z * r);
}

/** x = k * pi/2 + r with |r| <= pi/4. Returns r and k mod 4. */
function reduce(x: number): { r: number; q: number } {
  const k = Math.floor(x * INV_PIO2 + 0.5);
  let r = x - k * PIO2_1;
  r = r - k * PIO2_2;
  r = r - k * PIO2_2T;
  return { r, q: k - 4 * Math.floor(k / 4) };
}

export function sin(x: number): number {
  const { r, q } = reduce(x);
  if (q === 0) return kernelSin(r);
  if (q === 1) return kernelCos(r);
  if (q === 2) return -kernelSin(r);
  return -kernelCos(r);
}

export function cos(x: number): number {
  const { r, q } = reduce(x);
  if (q === 0) return kernelCos(r);
  if (q === 1) return -kernelSin(r);
  if (q === 2) return -kernelCos(r);
  return kernelSin(r);
}

export const tan = (x: number): number => sin(x) / cos(x);

const ATAN_HI = [4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1, 1.57079632679489655800e0];
const ATAN_LO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT0 = 3.33333333333329318027e-1;
const AT1 = -1.99999999998764832476e-1;
const AT2 = 1.42857142725034663711e-1;
const AT3 = -1.11111104054623557880e-1;
const AT4 = 9.09088713343650656196e-2;
const AT5 = -7.69187620504482999495e-2;
const AT6 = 6.66107313738753120669e-2;
const AT7 = -5.83357013379057348645e-2;
const AT8 = 4.97687799461593236017e-2;
const AT9 = -3.65315727442169155270e-2;
const AT10 = 1.62858201153657823623e-2;

export function atan(v: number): number {
  const neg = v < 0;
  let x = neg ? -v : v;
  let id: number;
  if (x < 0.4375) {
    id = -1;
  } else if (x < 0.6875) {
    id = 0;
    x = (2 * x - 1) / (2 + x);
  } else if (x < 1.1875) {
    id = 1;
    x = (x - 1) / (x + 1);
  } else if (x < 2.4375) {
    id = 2;
    x = (x - 1.5) / (1 + 1.5 * x);
  } else {
    id = 3;
    x = -1 / x;
  }
  const z = x * x;
  const w = z * z;
  const s1 = z * (AT0 + w * (AT2 + w * (AT4 + w * (AT6 + w * (AT8 + w * AT10)))));
  const s2 = w * (AT1 + w * (AT3 + w * (AT5 + w * (AT7 + w * AT9))));
  let result: number;
  if (id < 0) {
    result = x - x * (s1 + s2);
  } else {
    result = ATAN_HI[id]! - (x * (s1 + s2) - ATAN_LO[id]! - x);
  }
  return neg ? -result : result;
}

const PI = 3.141592653589793;

/** Angle of (x, y) in (-PI, PI]. atan2(0, 0) = 0. */
export function atan2(y: number, x: number): number {
  if (x > 0) return atan(y / x);
  if (x < 0) return y >= 0 ? atan(y / x) + PI : atan(y / x) - PI;
  if (y > 0) return PI / 2;
  if (y < 0) return -PI / 2;
  return 0;
}

const LN2_HI = 6.93147180369123816490e-1;
const LN2_LO = 1.90821492927058770002e-10;
const INV_LN2 = 1.44269504088896338700e0;
const SQRT_HALF = 0.7071067811865476;
const TWO32 = 4294967296;

const LG1 = 6.666666666666735130e-1;
const LG2 = 3.999999999940941908e-1;
const LG3 = 2.857142874366239149e-1;
const LG4 = 2.222219843214978396e-1;
const LG5 = 1.818357216161805012e-1;
const LG6 = 1.531383769920937332e-1;
const LG7 = 1.479819860511658591e-1;

/** Natural log for x > 0 (NaN below, -Infinity at 0). */
export function log(x: number): number {
  if (!(x > 0)) return x === 0 ? -Infinity : NaN;
  if (x === Infinity) return x;
  // x = m * 2^k with m in [sqrt(1/2), sqrt(2)), by exact power-of-two scaling.
  let m = x;
  let k = 0;
  while (m < SQRT_HALF / TWO32) {
    m *= TWO32;
    k -= 32;
  }
  while (m >= 2 * TWO32) {
    m /= TWO32;
    k += 32;
  }
  while (m < SQRT_HALF) {
    m *= 2;
    k -= 1;
  }
  while (m >= 2 * SQRT_HALF) {
    m /= 2;
    k += 1;
  }
  const f = m - 1;
  const s = f / (2 + f);
  const z = s * s;
  const w = z * z;
  const t1 = w * (LG2 + w * (LG4 + w * LG6));
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  const r = t2 + t1;
  const hfsq = 0.5 * f * f;
  return k * LN2_HI - (hfsq - (s * (hfsq + r) + k * LN2_LO) - f);
}

const P1 = 1.66666666666666019037e-1;
const P2 = -2.77777777770155933842e-3;
const P3 = 6.61375632143793436117e-5;
const P4 = -1.65339022054652515390e-6;
const P5 = 4.13813679705723846039e-8;

/** e^x. */
export function exp(x: number): number {
  if (x !== x) return x;
  if (x > 709.78) return Infinity;
  if (x < -745.2) return 0;
  const k = Math.floor(x * INV_LN2 + 0.5);
  const hi = x - k * LN2_HI;
  const lo = k * LN2_LO;
  const r = hi - lo;
  const t = r * r;
  const c = r - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  let y = 1 - (lo - (r * c) / (2 - c) - hi);
  // y * 2^k by exact power-of-two steps.
  let n = k;
  while (n > 0) {
    y *= 2;
    n -= 1;
  }
  while (n < -32) {
    y /= TWO32;
    n += 32;
  }
  while (n < 0) {
    y /= 2;
    n += 1;
  }
  return y;
}

/** x^p for x >= 0 (what the sim needs: profile curves). */
export function pow(x: number, p: number): number {
  if (p === 0 || x === 1) return 1;
  if (x === 0) return p > 0 ? 0 : Infinity;
  return exp(p * log(x));
}
