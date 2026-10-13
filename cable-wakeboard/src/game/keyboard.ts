import { carveToEdge, toeSign } from '../sim/edge';
import type { InputFrame } from '../sim/input';
import type { RiderState } from '../sim/rider';
import type { GrabId } from '../sim/tricks/data';

/** Grab keys, checked in order; the first held wins. */
const GRAB_KEYS: [string, GrabId][] = [
  ['KeyJ', 'indy'],
  ['KeyK', 'melon'],
  ['KeyL', 'mute'],
  ['KeyI', 'stalefish'],
  ['KeyU', 'nose'],
  ['KeyO', 'tail'],
];

export const CONTROLS_HELP = [
  'A/D or arrows: carve (water), spin (air), lean to balance (rail)',
  'F on a rail: turn the board across (boardslide)',
  'Space: hold to load, release to pop',
  'W / S held at pop: front / back invert',
  'Shift: arms out (bad posture)',
  'J K L I U O: indy melon mute stalefish nose tail',
  'R: raley   Q: let go   Enter: restart   P: pause',
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
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    target.addEventListener('blur', () => this.down.clear());
  }

  held(code: string): boolean {
    return this.down.has(code);
  }

  /** True once per key press. */
  consume(code: string): boolean {
    const had = this.pressed.has(code);
    this.pressed.delete(code);
    return had;
  }

  frame(rider: RiderState): InputFrame {
    const right = this.held('KeyD') || this.held('ArrowRight') ? 1 : 0;
    const left = this.held('KeyA') || this.held('ArrowLeft') ? 1 : 0;
    // +1 = to the rider's right of travel / clockwise seen from above.
    const steer = right - left;
    const up = this.held('KeyW') || this.held('ArrowUp') ? 1 : 0;
    const down = this.held('KeyS') || this.held('ArrowDown') ? 1 : 0;
    const airborne = rider.mode === 'air';
    const onRail = rider.jib !== null;
    // Spin input is in frontside units; clockwise yaw is frontside when -toeSign is +1.
    const stance = { stance: rider.stance, switchStance: rider.air?.takeoffSwitch ?? rider.switchStance };
    const spin = airborne ? -toeSign(stance) * steer : onRail && this.held('KeyF') ? 1 : 0;
    const grab = GRAB_KEYS.find(([code]) => this.held(code))?.[1] ?? null;
    return {
      edge: airborne ? 0 : carveToEdge(rider, steer),
      load: this.held('Space'),
      handleIn: this.held('ShiftLeft') || this.held('ShiftRight') ? 0 : 1,
      spin,
      flip: up - down,
      raley: this.held('KeyR'),
      grab,
      release: this.held('KeyQ'),
    };
  }
}
