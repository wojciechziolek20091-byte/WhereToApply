/**
 * Damped springs (spec section 1.4). `freq` is the natural frequency in Hz,
 * `damping` the damping ratio: 1 is critically damped, below 1 overshoots.
 * The step is implicit Euler, so it is stable at any frame time.
 */

export interface Spring {
  x: number;
  v: number;
}

export const spring = (x = 0): Spring => ({ x, v: 0 });

export interface SpringParams {
  freq: number;
  damping: number;
}

/** Advance `s` toward `target`; returns the new value. */
export function stepSpring(s: Spring, target: number, p: SpringParams, dt: number): number {
  const w = 2 * Math.PI * p.freq;
  const k = w * w;
  const c = 2 * p.damping * w;
  s.v = (s.v - dt * k * (s.x - target)) / (1 + dt * c + dt * dt * k);
  s.x += dt * s.v;
  return s.x;
}

/** Kick a spring's velocity (a yank, a landing). */
export function impulse(s: Spring, dv: number): void {
  s.v += dv;
}
