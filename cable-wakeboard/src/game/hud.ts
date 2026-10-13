import { clamp01 } from '../sim/math/scalar';
import { horizontalLength } from '../sim/math/vec';
import type { RunState } from '../sim/session';
import { CONTROLS_HELP } from './keyboard';

const bar = (value: number, max: number, warn = false): string =>
  `<div class="bar${warn ? ' warn' : ''}"><i style="width:${(clamp01(value / max) * 100).toFixed(0)}%"></i></div>`;

const escape = (s: string): string => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

/** Plain DOM HUD. Rebuilt each frame; cheap enough for a gray-box. */
export class Hud {
  constructor(private readonly el: HTMLElement) {}

  render(run: RunState, paused: boolean): void {
    const s = run.sim;
    const r = s.rider;
    const cfg = s.cfg;
    const kmh = horizontalLength(r.vel) * 3.6;
    const edgeSide = r.edgeAngle > 0.02 ? 'heelside' : r.edgeAngle < -0.02 ? 'toeside' : 'flat';
    const edgeDeg = Math.abs((r.edgeAngle * 180) / Math.PI).toFixed(0);
    const air = r.air;
    const recent = run.tricks
      .slice(-5)
      .reverse()
      .map((t) => `<div class="row"><span>${escape(t.trick.name)}</span><span>${t.trick.difficulty.toFixed(1)}</span></div>`)
      .join('');
    const lastFall = run.falls.at(-1);

    let score = '';
    if (run.finished && run.score) {
      const rows = run.score.judges
        .map(
          (j, i) =>
            `<tr><td>Judge ${i + 1}</td><td>${j.execution.toFixed(1)}</td><td>${j.intensity.toFixed(1)}</td><td>${j.composition.toFixed(1)}</td><td>${j.total.toFixed(1)}</td></tr>`,
        )
        .join('');
      score = `<h1>Run over (${run.endReason === 'falls' ? 'too many falls' : 'passes done'}): ${run.score.total.toFixed(1)}</h1>
        <table><tr><th></th><th>Exe</th><th>Int</th><th>Comp</th><th>Total</th></tr>${rows}</table>
        <div>Press Enter for a new run.</div>`;
    }

    this.el.innerHTML = `
      <h1>Cable Wakeboard${paused ? ' (paused)' : ''}</h1>
      <div class="row"><span>Pass ${Math.min(run.pass + 1, cfg.run.passesPerRun)} / ${cfg.run.passesPerRun}</span><span>Falls ${run.falls.length} / ${cfg.run.maxFalls}</span></div>
      <div class="row"><span>${r.mode}${r.switchStance ? ' (switch)' : ''}</span><span>${kmh.toFixed(0)} km/h</span></div>
      <div class="row"><span>Rope tension</span><span>${r.ropeTension.toFixed(0)} N</span></div>
      ${bar(r.ropeTension, cfg.rope.gripLimit, r.overGripTime > 0)}
      <div class="row"><span>Edge ${edgeSide} ${edgeDeg}&deg;</span><span>load ${r.edgeLoad.toFixed(0)} N</span></div>
      ${bar(r.edgeLoad, cfg.pop.edgeLoadRef)}
      <div class="row"><span>Connection</span><span>${(r.connection * 100).toFixed(0)}%</span></div>
      ${bar(r.connection, 1, r.connection < 0.5)}
      <div class="row"><span>Knees</span><span>${(r.legCompression * 100).toFixed(0)}%</span></div>
      ${bar(r.legCompression, 1)}
      ${
        air
          ? `<div class="row"><span>Air ${air.time.toFixed(2)} s</span><span>peak ${air.peakHeight.toFixed(1)} m</span></div>
             <div class="row"><span>Spin ${((air.spinAngle * 180) / Math.PI).toFixed(0)}&deg;</span><span>Invert ${((air.flipAngle * 180) / Math.PI).toFixed(0)}&deg;</span></div>`
          : r.jib
            ? `<div class="row"><span>Balance</span><span>${r.jib.balance.toFixed(2)}</span></div>${bar(Math.abs(r.jib.balance), 1, Math.abs(r.jib.balance) > 0.6)}`
            : '<div class="row"><span>&nbsp;</span></div><div class="row"><span>&nbsp;</span></div>'
      }
      <div class="tricks">${recent || '<div>No tricks yet</div>'}</div>
      ${lastFall ? `<div>Last fall: ${lastFall.kind}</div>` : ''}
      ${score}
      <div class="help">${CONTROLS_HELP.map(escape).join('<br>')}</div>`;
  }
}
