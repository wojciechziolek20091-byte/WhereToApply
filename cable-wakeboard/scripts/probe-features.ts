/** Ad-hoc: kickers and obstacles on one-feature parks. npx vite-node scripts/probe-features.ts */
import type { InputFrame } from '../src/sim/input';
import type { FeatureDef, SliderDef } from '../src/sim/park';
import { classifyAir, classifySlide } from '../src/sim/tricks/classify';
import { featureSim, runUntil } from '../tests/helpers';
import { neutralInput } from '../src/sim/input';
import { stepSim } from '../src/sim/step';

const kicker: FeatureDef = { kind: 'kicker', id: 'k', name: 'K', s: 135, offset: 0, length: 4.5, width: 3.5, height: 1.2, lipAngle: 0.5 };
const box = (safety: 'flush' | 'gap', style: SliderDef['style'] = 'box'): FeatureDef => ({
  kind: 'slider', id: 'b', name: 'B', style, s: 135, offset: 0, length: 8, width: style === 'box' ? 1 : 0.12, height: 0.5, entryLength: 3, safety,
});

function play(label: string, def: FeatureDef, script: (t: number, s: ReturnType<typeof featureSim>) => Partial<InputFrame>, cfg = {}) {
  const s = featureSim(def, cfg);
  const out: string[] = [];
  for (let i = 0; i < 60 * 9; i++) {
    stepSim(s, { ...neutralInput(), ...script(i / 60, s) });
    for (const e of s.events) {
      if (e.type === 'transition') out.push(`${(i / 60).toFixed(2)} ${e.to}(${e.reason})`);
      if (e.type === 'crash') out.push(`CRASH ${e.reason}`);
      if (e.type === 'landed') out.push(`landed "${classifyAir(e.air, e.landing, s.cfg)?.name ?? '-'}" peak ${e.air.peakHeight.toFixed(2)} vy0 ${e.air.popSpeed.toFixed(2)} lip ${e.air.lipPop}`);
      if (e.type === 'slideDone') out.push(`slide "${classifySlide(e.jib, s.cfg)?.name ?? '-'}" ${e.jib.time.toFixed(2)} s bal ${e.jib.balance.toFixed(2)}`);
    }
    if (s.rider.mode === 'crashed' || (i > 60 && s.rider.mode === 'riding' && out.some((o) => o.startsWith('landed')))) break;
  }
  console.log(label.padEnd(26), out.join(' | '));
}
// The rider starts about 17 m behind the carrier at s 125 -> about s 108; the feature is at s 135.
const at = (t0: number, t1: number) => (t: number) => t >= t0 && t < t1;
play('kicker straight', kicker, () => ({}));
for (const rel of [3.55, 3.65, 3.72, 3.76]) play(`kicker lip pop @${rel}`, kicker, (t) => ({ pop: at(rel - 0.4, rel)(t) }));
play('kicker BS 180', kicker, (t) => ({ steer: t > 3.4 && t < 3.6 ? 1 : 0 }));
play('flush box ride on', box('flush'), () => ({}), { feature: { balanceEnabled: false } });
play('gap box no pop', box('gap'), () => ({}), { feature: { balanceEnabled: false } });
for (const rel of [3.3, 3.45, 3.5, 3.52, 3.54]) play(`gap box pop @${rel}`, box('gap'), (t) => ({ pop: at(rel - 0.3, rel)(t) }), { feature: { balanceEnabled: false } });
play('flush early pop', box('flush'), (t) => ({ pop: at(3.0, 3.35)(t) }), { feature: { balanceEnabled: false } });
play('box hold D (90)', box('flush'), (t) => ({ steer: t > 3.5 && t < 3.7 ? 1 : 0 }), { feature: { balanceEnabled: false } });
play('box hold A (90)', box('flush'), (t) => ({ steer: t > 3.5 && t < 3.7 ? -1 : 0 }), { feature: { balanceEnabled: false } });
play('box 180 no pass', box('flush'), (t) => ({ steer: t > 3.5 && t < 3.9 ? 1 : 0 }), { feature: { balanceEnabled: false } });
play('box 180 with Q', box('flush'), (t) => ({ steer: t > 3.5 && t < 3.9 ? 1 : 0, pass: t > 3.75 && t < 3.8 }), { feature: { balanceEnabled: false } });
play('rail balance on', box('flush', 'rail'), () => ({}));
play('ollie onto box (low)', box('gap'), (t) => ({ pop: at(2.2, 2.25)(t) }), { feature: { balanceEnabled: false } });
play('ollie onto box (high)', box('gap'), (t) => ({ pop: at(1.7, 2.3)(t) }), { feature: { balanceEnabled: false } });
play('box pop off', box('flush'), (t) => ({ pop: at(3.6, 4.0)(t) }), { feature: { balanceEnabled: false } });
