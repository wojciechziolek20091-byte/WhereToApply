import { edgeNorm, toeSign } from '../sim/edge';
import { handleProgress, passWindowOf } from '../sim/handle';
import { clamp01 } from '../sim/math/scalar';
import { horizontalLength } from '../sim/math/vec';
import { safetyWindow } from '../sim/onFeature';
import { featureUnder } from '../sim/features';
import { waterTrickTiming } from '../sim/pop';
import type { CrashReason, RotationState } from '../sim/rider';
import { ropeRelativeYaw } from '../sim/rotation';
import { liveCombo, type RunState } from '../sim/session';
import { DT } from '../sim/config';
import { CONTROLS_HELP } from './keyboard';

const SEGMENTS = 24;
/** Tension meter full scale (N). */
const METER_MAX = 2000;

const CRASH_NAMES: Record<CrashReason, string> = {
  shortOllie: 'Short ollie: clipped the edge',
  missedSafetyPop: 'Missed the safety pop',
  handleDropped: 'Missed handle pass',
  underRotated: 'Under-rotated',
  overRotated: 'Over-rotated',
  grabHeldOnLanding: 'Still grabbing on landing',
  raleyExtendedOnLanding: 'Raley not swung down',
  caughtEdgeBlind: 'Caught an edge riding blind',
  fellOffFeature: 'Fell off the feature',
  ropeYank: 'Rope yank',
  badLandingYaw: 'Landed sideways',
  hardLanding: 'Landed too hard',
  hitFeature: 'Hit the feature',
  letGo: 'Let go of the handle',
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
const degs = (rad: number): string => `${((rad * 180) / Math.PI).toFixed(0)}°`;

const RING_R = 26;
const RING_C = 2 * Math.PI * RING_R;

/**
 * Game HUD (spec section 13): tiles across the top (time, tension meter with
 * the 1000 N mark and LOADED glow, speed, points), the trick feed and combo
 * multiplier, a pop timing bar (safety pops, water tricks), the handle-pass
 * ring, the balance meter on features, a help panel on H, the debug overlay
 * on F3, and the judges' cards at the end of a run.
 */
export class Hud {
  private readonly time: HTMLElement;
  private readonly ropeTile: HTMLElement;
  private readonly ropeValue: HTMLElement;
  private readonly ropeSegs: HTMLElement[] = [];
  private readonly speedValue: HTMLElement;
  private readonly speedFill: HTMLElement;
  private readonly speedMark: HTMLElement;
  private readonly points: HTMLElement;
  private readonly feed: HTMLElement;
  private readonly popup: HTMLElement;
  private readonly timing: HTMLElement;
  private readonly timingLabel: HTMLElement;
  private readonly timingWindow: HTMLElement;
  private readonly timingCursor: HTMLElement;
  private readonly ring: HTMLElement;
  private readonly ringWindow: SVGCircleElement;
  private readonly ringProgress: SVGCircleElement;
  private readonly ringLabel: HTMLElement;
  private readonly balance: HTMLElement;
  private readonly balanceCursor: HTMLElement;
  private readonly status: HTMLElement;
  private readonly help: HTMLElement;
  private readonly debug: HTMLElement;
  private readonly result: HTMLElement;
  private readonly pausedTag: HTMLElement;
  private popupUntil = 0;
  private seenTricks = 0;
  private seenCrashes = 0;
  private helpOpen = false;
  private debugOpen = false;
  private lastRun: RunState | null = null;
  private readonly el: HTMLElement;

  constructor(root: HTMLElement) {
    this.el = root;
    root.className = 'hud';
    root.innerHTML = '';
    const bar = el('div', 'hud-bar', root);

    const t = el('div', 'tile tile-time', bar);
    el('div', 'tile-label', t, 'Time');
    this.time = el('div', 'tile-big', t, '0:00');

    this.ropeTile = el('div', 'tile tile-rope', bar);
    const rh = el('div', 'tile-head', this.ropeTile);
    el('div', 'tile-label', rh, 'Rope');
    this.ropeValue = el('div', 'tile-num', rh, '0 N');
    const segs = el('div', 'segs', this.ropeTile);
    for (let i = 0; i < SEGMENTS; i++) {
      const s = el('i', 'seg', segs);
      s.style.setProperty('--hue', String(110 - (i / (SEGMENTS - 1)) * 110));
      this.ropeSegs.push(s);
    }
    const mark = el('b', 'seg-mark', segs);
    mark.style.left = `${(1000 / METER_MAX) * 100}%`;
    el('div', 'loaded-tag', this.ropeTile, 'LOADED');

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

    this.feed = el('div', 'feed', root);
    this.popup = el('div', 'popup', root);
    this.pausedTag = el('div', 'paused-tag', root, 'Paused (P)');

    // Pop timing bar (safety pops and water tricks).
    this.timing = el('div', 'timing', root);
    this.timingLabel = el('div', 'tile-label', this.timing, 'Pop');
    const tt = el('div', 'timing-track', this.timing);
    this.timingWindow = el('i', 'timing-window', tt);
    this.timingCursor = el('b', 'timing-cursor', tt);

    // Handle-pass ring.
    this.ring = el('div', 'ring', root);
    this.ring.innerHTML = `<svg viewBox="0 0 64 64" width="72" height="72" aria-hidden="true">
      <circle cx="32" cy="32" r="${RING_R}" class="ring-track"/>
      <circle cx="32" cy="32" r="${RING_R}" class="ring-window"/>
      <circle cx="32" cy="32" r="${RING_R}" class="ring-progress"/></svg>`;
    this.ringWindow = this.ring.querySelector('.ring-window')!;
    this.ringProgress = this.ring.querySelector('.ring-progress')!;
    this.ringLabel = el('div', 'ring-label', this.ring, 'Q');

    // Balance meter on features.
    this.balance = el('div', 'balance', root);
    el('div', 'tile-label', this.balance, 'Balance: tap A / D');
    const bt = el('div', 'balance-track', this.balance);
    this.balanceCursor = el('b', 'balance-cursor', bt);

    const helpChip = el('div', 'help-chip', root);
    helpChip.innerHTML = '<kbd>H</kbd> Help';
    this.help = el('div', 'help-panel', root);
    this.help.innerHTML = `<h2>Controls</h2><ul>${CONTROLS_HELP.map((c) => `<li>${escape(c)}</li>`).join('')}</ul>`;
    this.help.hidden = true;
    this.debug = el('div', 'debug-panel', root);
    this.debug.hidden = true;

    this.status = el('div', 'status-line', root);
    this.result = el('div', 'result', root);
    this.result.hidden = true;
  }

  toggleHelp(): void {
    this.helpOpen = !this.helpOpen;
    this.help.hidden = !this.helpOpen;
  }

  toggleDebug(): void {
    this.debugOpen = !this.debugOpen;
    this.debug.hidden = !this.debugOpen;
  }

  private flash(text: string, kind: 'trick' | 'fall', now: number): void {
    this.popup.className = `popup popup-${kind}`;
    this.popup.innerHTML = text;
    void this.popup.offsetWidth;
    this.popup.classList.add('popup-show');
    this.popupUntil = now + 1800;
  }

  private showRing(rot: RotationState | null, rate: number, inAir: boolean): void {
    const w = rot ? passWindowOf(rot, { rate, inAir }) : null;
    if (!rot || !w || rot.spinSide === null) {
      this.ring.hidden = true;
      return;
    }
    this.ring.hidden = false;
    // One turn of the ring is the zone plus a quarter either side.
    const from = w.zone.start - Math.PI / 4;
    const span = Math.PI;
    const frac = (x: number) => clamp01((x - from) / span);
    const p = frac(handleProgress(rot));
    const a = frac(w.centre - w.half);
    const b = frac(w.centre + w.half);
    this.ringProgress.style.strokeDasharray = `${p * RING_C} ${RING_C}`;
    this.ringWindow.style.strokeDasharray = `0 ${a * RING_C} ${(b - a) * RING_C} ${RING_C}`;
    this.ringLabel.textContent = rot.passTimer > 0 ? 'Pass!' : `Q ${rot.spinSide === 'backside' ? 'BS' : 'FS'}`;
  }

  render(run: RunState, paused: boolean, timeScale = 1): void {
    const now = performance.now();
    this.el.dataset.slowmo = timeScale < 1 ? `x${timeScale}` : '';
    if (run !== this.lastRun) {
      this.lastRun = run;
      this.seenTricks = run.tricks.length;
      this.seenCrashes = run.crashes.length;
    }
    const s = run.sim;
    const r = s.rider;
    const cfg = s.cfg;

    this.time.textContent = clock(s.time);

    const tension = r.tensionSmooth;
    this.ropeValue.textContent = `${tension.toFixed(0)} N`;
    const lit = Math.round(clamp01(tension / METER_MAX) * SEGMENTS);
    this.ropeSegs.forEach((seg, i) => seg.classList.toggle('on', i < lit));
    this.ropeTile.classList.toggle('loaded', r.mode === 'waterTrickLoad');

    const kmh = horizontalLength(r.vel) * 3.6;
    this.speedValue.textContent = `${kmh.toFixed(0)} km/h`;
    this.speedFill.style.width = `${clamp01(kmh / 55) * 100}%`;
    this.speedMark.style.left = `${clamp01((cfg.cable.carrierSpeed * 3.6) / 55) * 100}%`;

    const live = liveCombo(run);
    this.points.textContent = String(run.points + (live ? live.total : 0));

    // Trick feed: the combo being built, or the last one.
    if (run.combo && live) {
      const names = run.combo.entries.map((e, i) => `<li>${escape(e.name)} <span>${Math.round(live.perTrick[i]!)}</span></li>`).join('');
      this.feed.innerHTML = `<ul>${names}</ul><div class="feed-total">x${live.multiplier.toFixed(2)} = ${live.total}</div>`;
      this.feed.className = 'feed feed-live';
    } else if (run.lastCombo && s.tick - run.lastCombo.tick < 240) {
      const c = run.lastCombo;
      this.feed.innerHTML = c.voided
        ? `<div class="feed-total feed-void">Combo lost</div>`
        : `<div class="feed-total">${c.tricks > 1 ? `${c.tricks}-trick combo ` : ''}+${c.total}</div>`;
      this.feed.className = 'feed';
    } else {
      this.feed.innerHTML = '';
    }

    for (; this.seenTricks < run.tricks.length; this.seenTricks++) {
      const rec = run.tricks[this.seenTricks]!;
      this.flash(`${escape(rec.trick.name)} <span class="popup-pts">+${Math.round(rec.trick.points * rec.trick.quality)}</span>`, 'trick', now);
    }
    for (; this.seenCrashes < run.crashes.length; this.seenCrashes++) {
      const c = run.crashes[this.seenCrashes]!;
      this.flash(escape(CRASH_NAMES[c.reason]), 'fall', now);
    }
    if (now > this.popupUntil) this.popup.classList.remove('popup-show');
    this.pausedTag.hidden = !paused || run.finished;

    // Pop timing bar.
    const f = r.ramp ? s.features.find((x) => x.def.id === r.ramp!.featureId) : undefined;
    const safety = r.mode === 'onSafety' && r.ramp && f ? f.shape.pieces.find((p) => p.role === 'Safety') : undefined;
    if (r.ramp && f && safety) {
      const w = safetyWindow(safety, cfg);
      const len = safety.u1 - safety.u0;
      this.timing.hidden = false;
      this.timingLabel.textContent = `Safety pop (${f.shape.safetyMode.toLowerCase()})`;
      this.timingWindow.style.left = `${((w.start - safety.u0) / len) * 100}%`;
      this.timingWindow.style.width = `${((w.end - w.start) / len) * 100}%`;
      this.timingCursor.style.left = `${clamp01((r.ramp.u - safety.u0) / len) * 100}%`;
    } else if (r.mode === 'waterTrickLoad') {
      this.timing.hidden = false;
      this.timingLabel.textContent = 'Loaded: release at the peak';
      this.timingWindow.style.left = '80%';
      this.timingWindow.style.width = '20%';
      this.timingCursor.style.left = `${waterTrickTiming(r, cfg, DT) * 100}%`;
    } else {
      this.timing.hidden = true;
    }

    // Handle-pass ring and balance meter.
    if (r.air) this.showRing(r.air.rot, cfg.spin.rate, true);
    else if (r.jib) this.showRing(r.jib.rot, Math.PI / 2 / cfg.feature.rotateTimePer90, false);
    else this.showRing(null, 0, true);
    this.balance.hidden = !r.jib || !cfg.feature.balanceEnabled;
    if (r.jib) this.balanceCursor.style.left = `${clamp01((r.jib.balance + 1) / 2) * 100}%`;

    this.status.textContent = [
      `Pass ${Math.min(run.pass + 1, cfg.run.passesPerRun)}/${cfg.run.passesPerRun}`,
      `Crashes ${run.crashes.length}/${cfg.run.maxFalls}`,
      r.handle === 'behind' ? 'BLIND' : r.switchStance ? 'Switch' : 'Regular',
      `Best combo ${run.bestCombo}`,
    ].join('  ·  ');

    if (this.debugOpen) {
      const toes = toeSign(r);
      const rot = r.air?.rot ?? r.jib?.rot ?? null;
      const hit = featureUnder(s.features, r.pos);
      const surface = r.mode === 'crashed' ? 'None' : hit ? `${hit.feature.def.id} ${hit.surface.piece.role} #${hit.surface.piece.index}` : r.pos.y <= 0.01 ? 'Water' : 'None';
      this.debug.innerHTML = [
        ['State', r.mode],
        ['Tension raw / smooth', `${r.ropeTension.toFixed(0)} / ${r.tensionSmooth.toFixed(0)} N`],
        ['Edge amount', edgeNorm(r, cfg.edge).toFixed(2)],
        ['Spin yaw', rot ? degs(rot.spinAngle) : '-'],
        ['Flip angle', rot ? degs(rot.flipAngle) : '-'],
        ['Rope-relative yaw', degs(ropeRelativeYaw(r.heading + (rot?.spinAngle ?? 0), toes, r.ropeHeading))],
        ['Handle', r.handle],
        ['Surface', surface],
        ['Last crash', r.lastCrash ?? 'none'],
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
          <div class="tile-label">${run.endReason === 'falls' ? 'Run over: too many crashes' : 'Run complete'}</div>
          <div class="result-total">${run.score.total.toFixed(1)}</div>
          <table><tr><th></th><th>Execution</th><th>Intensity</th><th>Composition</th><th>Total</th></tr>${rows}</table>
          <p>${run.tricks.length} tricks, ${run.points} points, best combo ${run.bestCombo}. Press Enter for a new run.</p></div>`;
        this.result.hidden = false;
      }
    } else {
      this.result.hidden = true;
    }
  }
}
