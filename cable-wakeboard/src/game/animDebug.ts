import { SCENARIOS } from '../anim/testDriver';

/**
 * Pose scrubber (spec section 13): pick a test-driver clip and drag its
 * phase u from 0 to 1 to see each moment frozen. F7 toggles it; while it is
 * open the sim is paused and the rider shows the chosen clip.
 */
export class PoseScrubber {
  readonly el: HTMLDivElement;
  private readonly select: HTMLSelectElement;
  private readonly slider: HTMLInputElement;
  private readonly label: HTMLSpanElement;
  private readonly play: HTMLInputElement;
  open = false;

  constructor(parent: HTMLElement, initial: { name: string; u: number } | null) {
    this.el = document.createElement('div');
    this.el.className = 'pose-scrubber';
    this.select = document.createElement('select');
    for (const name of Object.keys(SCENARIOS)) {
      const o = document.createElement('option');
      o.value = name;
      o.textContent = name;
      this.select.appendChild(o);
    }
    this.slider = document.createElement('input');
    this.slider.type = 'range';
    this.slider.min = '0';
    this.slider.max = '1';
    this.slider.step = '0.005';
    this.label = document.createElement('span');
    const playLabel = document.createElement('label');
    this.play = document.createElement('input');
    this.play.type = 'checkbox';
    playLabel.append(this.play, ' play');
    this.el.append('Pose ', this.select, this.slider, this.label, playLabel);
    parent.appendChild(this.el);
    if (initial) {
      this.select.value = initial.name;
      this.slider.value = String(initial.u);
      this.open = true;
    } else this.slider.value = '0.5';
    this.slider.addEventListener('input', () => this.sync());
    this.select.addEventListener('change', () => this.sync());
    // Keys typed in the panel must not reach the game.
    this.el.addEventListener('keydown', (e) => e.stopPropagation());
    this.sync();
  }

  toggle(): void {
    this.open = !this.open;
    this.sync();
  }

  private sync(): void {
    this.el.style.display = this.open ? 'flex' : 'none';
    this.label.textContent = `u = ${Number(this.slider.value).toFixed(2)}`;
  }

  /** The clip and phase to show, advancing it when playing. */
  current(dt: number): { name: string; u: number } | null {
    if (!this.open) return null;
    if (this.play.checked) {
      const sc = SCENARIOS[this.select.value];
      let u = Number(this.slider.value) + dt / (sc ? sc.duration : 1);
      if (u > 1) u = 0;
      this.slider.value = String(u);
      this.sync();
    }
    return { name: this.select.value, u: Number(this.slider.value) };
  }
}
