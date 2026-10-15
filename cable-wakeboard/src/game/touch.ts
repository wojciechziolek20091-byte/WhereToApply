import type { Keyboard } from './keyboard';

/** On-screen buttons, each holding a keyboard key while pressed. */
const BUTTONS: { id: string; label: string; code: string; side: 'left' | 'right' }[] = [
  { id: 'touch-left', label: 'Left', code: 'KeyA', side: 'left' },
  { id: 'touch-right', label: 'Right', code: 'KeyD', side: 'left' },
  { id: 'touch-back', label: 'Backflip', code: 'KeyS', side: 'right' },
  { id: 'touch-grab', label: 'Grab', code: 'KeyJ', side: 'right' },
  { id: 'touch-pop', label: 'Pop', code: 'Space', side: 'right' },
];

/** Adds touch controls (shown only on touch screens via CSS) and wires them to the keyboard. */
export function mountTouchControls(root: HTMLElement, keys: Keyboard): void {
  const wrap = document.createElement('div');
  wrap.className = 'touch';
  const left = document.createElement('div');
  const right = document.createElement('div');
  left.className = 'touch-group';
  right.className = 'touch-group';
  for (const b of BUTTONS) {
    const btn = document.createElement('button');
    btn.id = b.id;
    btn.type = 'button';
    btn.textContent = b.label;
    btn.className = b.code === 'Space' ? 'touch-btn touch-pop' : 'touch-btn';
    const press = (down: boolean) => (e: PointerEvent) => {
      e.preventDefault();
      if (down) btn.setPointerCapture(e.pointerId);
      btn.classList.toggle('held', down);
      keys.set(b.code, down);
    };
    btn.addEventListener('pointerdown', press(true));
    btn.addEventListener('pointerup', press(false));
    btn.addEventListener('pointercancel', press(false));
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    (b.side === 'left' ? left : right).appendChild(btn);
  }
  wrap.append(left, right);
  root.appendChild(wrap);
}

/** Rider choices shown on the start screen. */
const RIDERS: { id: string; label: string; swatch: [string, string] }[] = [
  { id: 'Sheet', label: 'Sage and navy', swatch: ['#62906a', '#1e223a'] },
  { id: 'A', label: 'Royal blue', swatch: ['#2652cc', '#96d82c'] },
  { id: 'B', label: 'Green and brick', swatch: ['#349856', '#9e3c2e'] },
];

/**
 * A start screen with a rider picker. The game needs a click or tap before it
 * receives keys. `onPick` fires when a rider is chosen, `onStart` on Start.
 */
export function mountStartScreen(
  root: HTMLElement,
  onStart: () => void,
  onPick: (rider: string) => void = () => {},
  initial = 'Sheet',
): void {
  const overlay = document.createElement('div');
  overlay.className = 'start';
  const riders = RIDERS.map(
    (r) => `<button type="button" class="rider-pick" id="rider-${r.id}" data-rider="${r.id}" aria-pressed="${r.id === initial}">
        <span class="rider-swatch" style="background:linear-gradient(135deg, ${r.swatch[0]} 50%, ${r.swatch[1]} 50%)"></span>${r.label}</button>`,
  ).join('');
  overlay.innerHTML = `
    <div class="start-card">
      <p class="start-eyebrow">Full-size cable, 30 km/h, 4 towers, 2 kickers, a box and a rail</p>
      <h1 class="start-title">Cable Wakeboard</h1>
      <p class="start-body">Cut out from the line, cut back in, and release the pop while the rope is loaded.
        Two laps per run, two falls and you are out. Three judges score the run.</p>
      <div class="rider-row" role="group" aria-label="Rider">${riders}</div>
      <button type="button" id="start-ride" class="start-btn">Start riding</button>
      <p class="start-keys">Keyboard: A/D carve, hold and release Space to pop, W/S at the pop to flip,
        J K L I U O grabs, Enter restarts. Touch screens get on-screen buttons.</p>
    </div>`;
  root.appendChild(overlay);
  overlay.querySelectorAll<HTMLButtonElement>('.rider-pick').forEach((btn) => {
    btn.addEventListener('click', () => {
      overlay.querySelectorAll('.rider-pick').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      btn.setAttribute('aria-pressed', 'true');
      onPick(btn.dataset.rider!);
    });
  });
  const start = () => {
    overlay.hidden = true;
    window.focus();
    onStart();
  };
  overlay.querySelector('#start-ride')!.addEventListener('click', start);
}
