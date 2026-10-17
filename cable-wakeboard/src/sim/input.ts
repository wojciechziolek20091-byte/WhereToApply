import type { SimConfig } from './config';
import type { GrabId } from './tricks/data';

/**
 * Everything the player holds in one tick, as raw buttons. Device-agnostic:
 * keyboard, gamepad and touch all fill this in. The sim works out presses,
 * releases, taps and grab chords itself (InputMemory) so every platform
 * behaves the same.
 *
 * | Key         | Water                       | Feature              | Air            |
 * |-------------|-----------------------------|----------------------|----------------|
 * | A / D       | carve (edge from stance)    | rotate board 90 deg  | spin           |
 * | Space       | hold: charge; release: pop  | hold/release: pop off| -              |
 * | S + Space   | backroll (when loaded)      | -                    | -              |
 * | W + Space   | frontroll (when loaded)     | -                    | -              |
 * | W / S       | -                           | -                    | front flip / tantrum |
 * | Q           | -                           | handle pass          | handle pass    |
 * | E (+R/N/T)  | -                           | -                    | indy (stalefish / nose / tail) |
 */
export interface InputFrame {
  /** A/D: -1 = A (left), +1 = D (right of travel / clockwise from above). */
  steer: number;
  /** Space held. */
  pop: boolean;
  /** W held. */
  forward: boolean;
  /** S held. */
  back: boolean;
  /** Q held (handle pass). */
  pass: boolean;
  /** E held (grab). */
  grab: boolean;
  /** R / N / T held with E: stalefish / nose / tail. */
  grabMod: Exclude<GrabId, 'indy'> | null;
  /** Shift held: arms out (bad posture). */
  armsOut: boolean;
  /** X held: let go of the handle. */
  letGo: boolean;
}

export const neutralInput = (): InputFrame => ({
  steer: 0,
  pop: false,
  forward: false,
  back: false,
  pass: false,
  grab: false,
  grabMod: null,
  armsOut: false,
  letGo: false,
});

/** Edges and timers derived from the raw input, updated once per tick. Plain data. */
export interface InputMemory {
  prev: InputFrame;
  /** Space pressed / released this tick. */
  popPressed: boolean;
  popReleased: boolean;
  /** How long Space has been held, or was held when it was just released (s). */
  popHeldTime: number;
  /** Q pressed this tick. */
  passPressed: boolean;
  /** Direction A/D is held (-1, 0, 1) and for how long (s). */
  steerDir: number;
  steerHeldTime: number;
  /** The last A/D direction held and how long ago it was let go (0 while held), for the pre-wind. */
  lastSteerDir: number;
  steerAge: number;
  /** A/D released this tick after a short press: its direction, else 0. */
  steerTap: number;
  /** W / S held (+1 W, -1 S, 0) and for how long (s); a short press released this tick (presses, fore-aft balance). */
  foreDir: number;
  foreHeldTime: number;
  foreTap: number;
  /** Grab chord: seconds since E went down, and the grab it resolved to. */
  grabTime: number;
  grabChoice: GrabId | null;
}

export const createInputMemory = (): InputMemory => ({
  prev: neutralInput(),
  popPressed: false,
  popReleased: false,
  popHeldTime: 0,
  passPressed: false,
  steerDir: 0,
  steerHeldTime: 0,
  lastSteerDir: 0,
  steerAge: 0,
  steerTap: 0,
  foreDir: 0,
  foreHeldTime: 0,
  foreTap: 0,
  grabTime: 0,
  grabChoice: null,
});

const steerDirOf = (steer: number): number => (steer > 0.5 ? 1 : steer < -0.5 ? -1 : 0);

/**
 * Advance the memory with this tick's input. Grab chords: E alone is an indy
 * once `grab.chordWindow` has passed; R, N or T held when E goes down or
 * within the window picks stalefish, nose or tail instead.
 */
export function updateInputMemory(m: InputMemory, input: InputFrame, cfg: SimConfig, dt: number): void {
  const prev = m.prev;
  m.popPressed = input.pop && !prev.pop;
  m.popReleased = !input.pop && prev.pop;
  if (m.popPressed) m.popHeldTime = 0;
  else if (input.pop) m.popHeldTime += dt;
  m.passPressed = input.pass && !prev.pass;

  const dir = steerDirOf(input.steer);
  m.steerTap = 0;
  if (dir !== m.steerDir) {
    if (m.steerDir !== 0 && m.steerHeldTime < cfg.feature.tapTime) m.steerTap = m.steerDir;
    m.steerDir = dir;
    m.steerHeldTime = 0;
  } else if (dir !== 0) {
    m.steerHeldTime += dt;
  }
  if (dir !== 0) {
    m.lastSteerDir = dir;
    m.steerAge = 0;
  } else m.steerAge += dt;

  const fore = input.forward ? 1 : input.back ? -1 : 0;
  m.foreTap = 0;
  if (fore !== m.foreDir) {
    if (m.foreDir !== 0 && m.foreHeldTime < cfg.feature.tapTime) m.foreTap = m.foreDir;
    m.foreDir = fore;
    m.foreHeldTime = 0;
  } else if (fore !== 0) {
    m.foreHeldTime += dt;
  }

  if (!input.grab) {
    m.grabTime = 0;
    m.grabChoice = null;
  } else {
    if (!prev.grab) m.grabTime = 0;
    else m.grabTime += dt;
    if (m.grabChoice === null || (m.grabChoice === 'indy' && input.grabMod && m.grabTime <= cfg.grab.chordWindow)) {
      if (input.grabMod && m.grabTime <= cfg.grab.chordWindow) m.grabChoice = input.grabMod;
      else if (m.grabTime >= cfg.grab.chordWindow) m.grabChoice = 'indy';
    }
  }
  m.prev = { ...input };
}
