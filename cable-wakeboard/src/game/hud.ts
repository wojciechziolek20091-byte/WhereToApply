import { clamp01 } from '../sim/math/scalar';
import { horizontalLength } from '../sim/math/vec';
import { trickPoints, type RunState } from '../sim/session';
import { CONTROLS_HELP } from './keyboard';

const SEGMENTS = 24;

const FALL_NAMES: Record<string, string> = {
  buttCheck: 'Butt check',
  caughtEdge: 'Caught edge',
  overRotation: 'Over-rotated',
  underRotation: 'Under-rotated',
  droppedHandle: 'Dropped the handle',
  featureCrash: 'Crashed the feature',
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  parent?.appendChild(e);
  return e;
};
const escape = (s: string): string => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
const clock = (t: number): string => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/**
 * Game HUD: four tiles across the top (time, rope tension, speed, points),
 * a trick popup, a help panel on H, a status line, and the judges' cards at
 * the end of a run. Built once; each frame only updates text and widths.
 */
export class Hud {
  private readonly time: HTMLElement;
  private readonly ropeValue: HTMLElement;
  private readonly ropeSegs: HTMLElement[] = [];
  private readonly ropeMark: HTMLElement;
  private readonly speedValue: HTMLElement;
  private readonly speedFill: HTMLElement;
  private readonly speedMark: HTMLElement;
  private readonly points: HTMLElement;
  private readonly pointsGain: HTMLElement;
  private readonly popup: HTMLElement;
  private readonly status: HTMLElement;
  private readonly help: HTMLElement;
  private readonly helpStats: HTMLElement;
  private readonly result: HTMLElement;
  private readonly pausedTag: HTMLElement;
  private popupUntil = 0;
  private gainUntil = 0;
  private seenTricks = 0;
  private seenFalls = 0;
  private helpOpen = false;
  private lastRun: RunState | null = null;

  constructor(root: HTMLElement) {
    root.className = 'hud';
    root.innerHTML = '';
    const bar = el('div', 'hud-bar', root);

    const t = el('div', 'tile tile-time', bar);
    el('div', 'tile-label', t, 'Time');
    this.time = el('div', 'tile-big', t, '0:00');

    const r = el('div', 'tile tile-rope', bar);
    const rh = el('div', 'tile-head', r);
    el('div', 'tile-label', rh, 'Rope');
    this.ropeValue = el('div', 'tile-num', rh, '0 N');
    const segs = el('div', 'segs', r);
    for (let i = 0; i < SEGMENTS; i++) {
      const s = el('i', 'seg', segs);
      s.style.setProperty('--hue', String(110 - (i / (SEGMENTS - 1)) * 110));
      this.ropeSegs.push(s);
    }
    this.ropeMark = el('b', 'seg-mark', segs);

    const sp = el('div', 'tile tile-speed', bar);
    const sh = el('div', 'tile-head', sp);
    el('div', 'tile-label', sh, 'Speed');
    this.speedValue = el('div', 'tile-num', sh, '0 km/h');
    const track = el('div', 'speed-track', sp);
    this.speedFill = el('i', 'speed-fill', track);
    this.speedMark = el('b', 'speed-mark', track);
    el('div', 'tile-hint', sp, 'Hold Space, release to pop');

    const pt = el('div', 'tile tile-points', bar);
    el('div', 'tile-label', pt, 'Points');
    this.points = el('div', 'tile-big', pt, '0');
    this.pointsGain = el('div', 'points-gain', pt);

    this.popup = el('div', 'popup', root);
    this.pausedTag = el('div', 'paused-tag', root, 'Paused (P)');

    const helpChip = el('div', 'help-chip', root);
    helpChip.innerHTML = '<kbd>H</kbd> Help';
    this.help = el('div', 'help-panel', root);
    this.help.innerHTML = `<h2>Controls</h2><ul>${CONTROLS_HELP.map((c) => `<li>${escape(c)}</li>`).join('')}<li>H: show or hide this help</li></ul><h2>Rider</h2>`;
    this.helpStats = el('div', 'help-stats', this.help);
    this.help.hidden = true;

    this.status = el('div', 'status-line', root);
    this.result = el('div', 'result', root);
    this.result.hidden = true;
  }

  toggleHelp(): void {
    this.helpOpen = !this.helpOpen;
    this.help.hidden = !this.helpOpen;
  }

  private flash(text: string, kind: 'trick' | 'fall', now: number): void {
    this.popup.className = `popup popup-${kind}`;
    this.popup.innerHTML = text;
    // Restart the CSS animation.
    void this.popup.offsetWidth;
    this.popup.classList.add('popup-show');
    this.popupUntil = now + 1800;
  }

  render(run: RunState, paused: boolean): void {
    const now = performance.now();
    if (run !== this.lastRun) {
      this.lastRun = run;
      this.seenTricks = run.tricks.length;
      this.seenFalls = run.falls.length;
    }
    const s = run.sim;
    const r = s.rider;
    const cfg = s.cfg;

    this.time.textContent = clock(s.time);

    const tension = r.ropeTension;
    this.ropeValue.textContent = `${tension.toFixed(0)} N`;
    const lit = Math.round(clamp01(tension / cfg.rope.gripLimit) * SEGMENTS);
    this.ropeSegs.forEach((seg, i) => seg.classList.toggle('on', i < lit));
    this.ropeMark.style.left = `${clamp01(cfg.pop.tensionRef / cfg.rope.gripLimit) * 100}%`;

    const kmh = horizontalLength(r.vel) * 3.6;
    this.speedValue.textContent = `${kmh.toFixed(0)} km/h`;
    this.speedFill.style.width = `${clamp01(kmh / 55) * 100}%`;
    this.speedMark.style.left = `${clamp01((cfg.cable.carrierSpeed * 3.6) / 55) * 100}%`;

    this.points.textContent = String(run.points);

    // New tricks and falls since the last frame.
    for (; this.seenTricks < run.tricks.length; this.seenTricks++) {
      const rec = run.tricks[this.seenTricks]!;
      const pts = trickPoints(rec);
      this.flash(`${escape(rec.trick.name)} <span class="popup-pts">+${pts}</span>`, 'trick', now);
      this.pointsGain.textContent = `+${pts}`;
      this.pointsGain.classList.remove('gain-show');
      void this.pointsGain.offsetWidth;
      this.pointsGain.classList.add('gain-show');
      this.gainUntil = now + 1500;
    }
    for (; this.seenFalls < run.falls.length; this.seenFalls++) {
      const f = run.falls[this.seenFalls]!;
      this.flash(escape(FALL_NAMES[f.kind] ?? f.kind), 'fall', now);
    }
    if (now > this.popupUntil) this.popup.classList.remove('popup-show');
    if (now > this.gainUntil) this.pointsGain.classList.remove('gain-show');

    this.pausedTag.hidden = !paused || run.finished;

    const edgeSide = r.edgeAngle > 0.02 ? 'heelside' : r.edgeAngle < -0.02 ? 'toeside' : 'flat';
    const edgeDeg = Math.abs((r.edgeAngle * 180) / Math.PI).toFixed(0);
    this.status.textContent = [
      `Rider ${kmh.toFixed(0)} km/h`,
      `Pass ${Math.min(run.pass + 1, cfg.run.passesPerRun)}/${cfg.run.passesPerRun}`,
      `Falls ${run.falls.length}/${cfg.run.maxFalls}`,
      `Edge ${edgeSide}${edgeSide === 'flat' ? '' : ` ${edgeDeg}°`}`,
      r.switchStance ? 'Switch' : 'Regular',
    ].join('  ·  ');

    if (this.helpOpen) {
      const air = r.air;
      this.helpStats.innerHTML = [
        ['Mode', r.mode],
        ['Edge load', `${r.edgeLoad.toFixed(0)} N`],
        ['Connection', `${(r.connection * 100).toFixed(0)}%`],
        ['Knees', `${(r.legCompression * 100).toFixed(0)}%`],
        ['Air', air ? `${air.time.toFixed(2)} s, peak ${air.peakHeight.toFixed(1)} m` : 'on the water'],
        ['Last fall', run.falls.at(-1)?.kind ?? 'none'],
      ]
        .map(([k, v]) => `<div><span>${k}</span><b>${escape(String(v))}</b></div>`)
        .join('');
    }

    if (run.finished && run.score) {
      if (this.result.hidden) {
        const rows = run.score.judges
          .map((j, i) => `<tr><td>Judge ${i + 1}</td><td>${j.execution.toFixed(1)}</td><td>${j.intensity.toFixed(1)}</td><td>${j.composition.toFixed(1)}</td><td>${j.total.toFixed(1)}</td></tr>`)
          .join('');
        this.result.innerHTML = `<div class="result-card">
          <div class="tile-label">${run.endReason === 'falls' ? 'Run over: too many falls' : 'Run complete'}</div>
          <div class="result-total">${run.score.total.toFixed(1)}</div>
          <table><tr><th></th><th>Execution</th><th>Intensity</th><th>Composition</th><th>Total</th></tr>${rows}</table>
          <p>${run.tricks.length} tricks, ${run.points} points. Press Enter for a new run.</p></div>`;
        this.result.hidden = false;
      }
    } else {
      this.result.hidden = true;
    }
  }
}
