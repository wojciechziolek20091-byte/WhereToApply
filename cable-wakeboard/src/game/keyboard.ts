import type { InputFrame } from '../sim/input';
import type { GrabId } from '../sim/tricks/data';

/** Grab modifier keys (with E): stalefish, nose, tail. */
const GRAB_MODS: [string, Exclude<GrabId, 'indy'>][] = [
  ['KeyR', 'stalefish'],
  ['KeyN', 'nose'],
  ['KeyT', 'tail'],
];

export const CONTROLS_HELP = [
  'A/D or arrows: carve (water), rotate the board (box/rail), spin (air)',
  'Space: hold to charge, release to pop. Edge hard away from the line until LOADED (1000 N) for a raley',
  'S + Space / W + Space when LOADED: backroll / frontroll',
  'W / S in the air: front flip / tantrum. A/D in a raley: S-bend',
  'Q: handle pass, in the ring window (no pass on a backside spin = to blind)',
  'Blind: tap A/D the way you came to spin out, or pop and spin out',
  'E: indy. E+R stalefish, E+N nose, E+T tail. Let go before landing',
  'Box/rail: tap A/D to balance, hold to rotate 90. Shift: arms out. X: let go',
  'Enter: restart   P: pause   F3: debug   H: help',
];

/** Tracks held keys and turns them into an InputFrame for the current rider. */
export class Keyboard {
  private readonly down = new Set<string>();
  /** Keys pressed since the last call to `consume()`. */
  private readonly pressed = new Set<string>();

  constructor(target: Window) {
    target.addEventListener('keydown', (e) => {
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
      if (e.code === 'Space' || e.code === 'F3' || e.code.startsWith('Arrow')) e.preventDefault();
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    target.addEventListener('blur', () => this.down.clear());
  }

  held(code: string): boolean {
    return this.down.has(code);
  }

  /** Press or release a key from another source (on-screen touch buttons). */
  set(code: string, isDown: boolean): void {
    if (isDown && !this.down.has(code)) this.pressed.add(code);
    if (isDown) this.down.add(code);
    else this.down.delete(code);
  }

  /** True once per key press. */
  consume(code: string): boolean {
    const had = this.pressed.has(code);
    this.pressed.delete(code);
    return had;
  }

  /** The raw buttons for this tick. The sim works out presses, taps and chords. */
  frame(): InputFrame {
    const right = this.held('KeyD') || this.held('ArrowRight') ? 1 : 0;
    const left = this.held('KeyA') || this.held('ArrowLeft') ? 1 : 0;
    return {
      steer: right - left,
      pop: this.held('Space'),
      forward: this.held('KeyW') || this.held('ArrowUp'),
      back: this.held('KeyS') || this.held('ArrowDown'),
      pass: this.held('KeyQ'),
      grab: this.held('KeyE'),
      grabMod: GRAB_MODS.find(([code]) => this.held(code))?.[1] ?? null,
      armsOut: this.held('ShiftLeft') || this.held('ShiftRight'),
      letGo: this.held('KeyX'),
    };
  }
}
