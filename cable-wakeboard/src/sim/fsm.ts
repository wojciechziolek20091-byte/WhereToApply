import type { RiderMode } from './rider';
import type { SimState } from './world';

/**
 * Legal moves of the rider state machine (spec section 4.3). Anything else is
 * a bug: with `debug.enabled` it throws, so tests catch it.
 */
export const TRANSITIONS: Record<RiderMode, readonly RiderMode[]> = {
  riding: ['waterTrickLoad', 'airborne', 'onKicker', 'onSafety', 'crashed'],
  ridingBlind: ['riding', 'airborne', 'crashed'],
  waterTrickLoad: ['riding', 'waterTrickAir', 'airborne', 'onKicker', 'onSafety', 'crashed'],
  waterTrickAir: ['landing', 'onFeature', 'crashed'],
  airborne: ['landing', 'onFeature', 'onKicker', 'crashed'],
  onKicker: ['airborne', 'onFeature', 'riding', 'crashed'],
  onSafety: ['airborne', 'onFeature', 'crashed'],
  onFeature: ['airborne', 'onKicker', 'riding', 'crashed'],
  landing: ['riding', 'ridingBlind', 'onKicker', 'onSafety', 'onFeature', 'crashed'],
  crashed: ['riding'],
};

export const canTransition = (from: RiderMode, to: RiderMode): boolean => TRANSITIONS[from].includes(to);

/**
 * The one place the rider's mode changes. `reason` is a short tag for the
 * debug log ('pop', 'lip', 'touchdown', ...).
 */
export function transition(s: SimState, to: RiderMode, reason: string): void {
  const r = s.rider;
  const from = r.mode;
  if (from === to) return;
  if (s.cfg.debug.enabled) {
    if (!canTransition(from, to)) throw new Error(`illegal transition ${from} -> ${to} (${reason})`);
    s.events.push({ type: 'transition', tick: s.tick, from, to, reason });
  }
  r.mode = to;
  r.modeTime = 0;
}

/** Modes where the board is on the water. */
export const onWater = (mode: RiderMode): boolean =>
  mode === 'riding' || mode === 'ridingBlind' || mode === 'waterTrickLoad' || mode === 'landing';

/** Modes where the rider is in the air. */
export const inAir = (mode: RiderMode): boolean => mode === 'airborne' || mode === 'waterTrickAir';
