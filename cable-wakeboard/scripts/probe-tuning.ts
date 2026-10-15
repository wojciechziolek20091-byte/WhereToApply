/**
 * Milestone 10 tuning pass: every trick played 5 times with the inputs shifted
 * by a few ticks each time, as a player would. Prints the success rate and
 * what each attempt produced. npx vite-node scripts/probe-tuning.ts
 */
import type { SimEvent } from '../src/sim/events';
import type { InputFrame } from '../src/sim/input';
import type { FeatureDef } from '../src/sim/park';
import { classifyAir, classifySlide } from '../src/sim/tricks/classify';
import type { SimState } from '../src/sim/world';
import { cutAndPop, featureSim, flatSim, run, runUntil } from '../tests/helpers';

type Script = (t: number, s: SimState) => Partial<InputFrame>;
const between = (a: number, b: number) => (t: number) => t >= a && t < b;
const JITTER = [-0.05, -0.025, 0, 0.025, 0.05];

/** Every event from a scripted run until the rider is back riding (or crashed) after something happened. */
function play(s: SimState, script: Script, seconds = 8): SimEvent[] {
  const events: SimEvent[] = [];
  // Stop at a crash or once the rider is back on the water after landing on it.
  runUntil(s, seconds, script, (e) => {
    events.push(e);
    return e.type === 'crash' || (e.type === 'landed' && !e.onFeature);
  });
  return events;
}
function outcome(s: SimState, events: SimEvent[]): string {
  const crash = events.find((e) => e.type === 'crash');
  const names: string[] = [];
  for (const e of events) {
    if (e.type === 'landed') {
      const t = classifyAir(e.air, e.landing, s.cfg);
      if (t) names.push(t.name + (e.landing.clean ? '' : ' (sketchy)'));
    }
    if (e.type === 'slideDone') {
      const t = classifySlide(e.jib, s.cfg);
      if (t) names.push(t.name);
    }
  }
  return crash?.type === 'crash' ? `CRASH ${crash.reason}${names.length ? ` after ${names.join(', ')}` : ''}` : names.join(' + ') || 'nothing';
}

interface Case {
  name: string;
  want: RegExp;
  attempt: (j: number) => { s: SimState; events: SimEvent[] };
}
const ollie = (air: (j: number) => Script) => (j: number) => {
  const s = flatSim();
  run(s, 3);
  run(s, 0.6, () => ({ pop: true }));
  return { s, events: play(s, air(j)) };
};
const water = (opts: { back?: boolean; forward?: boolean }, air: (j: number) => Script = () => () => ({})) => (j: number) => {
  const s = flatSim();
  cutAndPop(s, { ...opts, releaseAt: 1.05 + j * 2 });
  return { s, events: play(s, air(j)) };
};
const kicker: FeatureDef = { kind: 'kicker', id: 'k', name: 'K', s: 135, offset: 0, length: 4.5, width: 3.5, height: 1.2, lipAngle: 0.5 };
const box = (safety: 'flush' | 'gap'): FeatureDef => ({ kind: 'slider', id: 'b', name: 'B', style: 'box', s: 135, offset: 0, length: 8, width: 1, height: 0.5, entryLength: 3, safety });
const onFeature = (def: FeatureDef, script: (j: number) => Script) => (j: number) => {
  const s = featureSim(def);
  return { s, events: play(s, script(j), 7) };
};

const CASES: Case[] = [
  { name: 'Frontside 180', want: /^Frontside 180$/, attempt: ollie((j) => (t) => ({ steer: t < 0.25 + j ? -1 : 0 })) },
  { name: 'Backside 180 to Blind', want: /Backside 180 to Blind/, attempt: ollie((j) => (t) => ({ steer: t < 0.4 + j ? 1 : 0 })) },
  { name: 'Backside 360 (pass)', want: /^Backside 360$/, attempt: ollie((j) => (t) => ({ steer: t < 0.62 ? 1 : 0, pass: between(0.2 + j, 0.25 + j)(t) })) },
  { name: 'Frontside 360 (pass)', want: /^Frontside 360$/, attempt: ollie((j) => (t) => ({ steer: t < 0.62 ? -1 : 0, pass: between(0.37 + j, 0.42 + j)(t) })) },
  { name: 'Front Flip', want: /^Front Flip$/, attempt: ollie((j) => (t) => ({ forward: t < 0.85 + j })) },
  { name: 'Tantrum', want: /^Tantrum$/, attempt: ollie((j) => (t) => ({ back: t < 0.85 + j })) },
  { name: 'Indy', want: /Indy/, attempt: ollie((j) => (t) => ({ grab: between(0.1 + j, 0.8 + j)(t) })) },
  { name: 'Stalefish (E+R)', want: /Stalefish/, attempt: ollie((j) => (t) => ({ grab: between(0.1, 0.8 + j)(t), grabMod: between(0.12 + j / 2, 0.8)(t) ? 'stalefish' : null })) },
  { name: 'Nose (E+N)', want: /Nose/, attempt: ollie((j) => (t) => ({ grab: between(0.1, 0.8 + j)(t), grabMod: 'nose' })) },
  { name: 'Tail (E+T)', want: /Tail/, attempt: ollie((j) => (t) => ({ grab: between(0.1, 0.8 + j)(t), grabMod: 'tail' })) },
  {
    name: 'Blind 180 Out',
    want: /Blind 180 Out/,
    attempt: (j) => {
      const s = flatSim();
      run(s, 3);
      run(s, 0.6, () => ({ pop: true }));
      play(s, () => ({ steer: 1 }), 2);
      run(s, 0.3 + j);
      run(s, 0.4, () => ({ pop: true }));
      return { s, events: play(s, (t) => ({ steer: t < 0.3 ? -1 : 0 })) };
    },
  },
  { name: 'Kicker lip pop', want: /Kicker Air Pop/, attempt: onFeature(kicker, (j) => (t) => ({ pop: between(3.3 + j, 3.7 + j)(t) })) },
  { name: 'Kicker BS 360 (pass)', want: /Backside 360/, attempt: onFeature(kicker, (j) => (t) => ({ steer: between(3.8, 4.42)(t) ? 1 : 0, pass: between(3.98 + j, 4.03 + j)(t) })) },
  { name: 'Pop-on (gap box)', want: /Pop-on 50-50/, attempt: onFeature(box('gap'), (j) => (t) => ({ pop: between(3.2, 3.5 + j / 5)(t) })) },
  {
    name: 'Backboard, 90 off',
    want: /Backboard.*90 Off/,
    attempt: onFeature(box('flush'), (j) => (t) => ({ steer: between(3.6 + j, 3.8 + j)(t) ? -1 : between(4.6, 4.75 + j)(t) ? 1 : 0 })),
  },
  { name: '180 on (pass)', want: /Switch 50-50/, attempt: onFeature(box('flush'), (j) => (t) => ({ steer: between(3.6, 4.0)(t) ? 1 : 0, pass: between(3.85 + j / 2, 3.9 + j / 2)(t) })) },
  { name: 'Raley', want: /^Raley$/, attempt: water({}) },
  { name: 'Backroll', want: /^Backroll$/, attempt: water({ back: true }) },
  { name: 'Frontroll', want: /^Frontroll$/, attempt: water({ forward: true }) },
  { name: 'S-Bend', want: /^S-Bend$/, attempt: water({}, (j) => (t) => ({ steer: between(0.45 + j, 0.55 + j)(t) ? 1 : 0 })) },
  { name: 'Mobe (backroll 360)', want: /^Mobe/, attempt: water({ back: true }, (j) => (t) => ({ steer: t < 0.6 ? 1 : 0, pass: between(0.2 + j, 0.25 + j)(t) })) },
  { name: 'Raley Indy', want: /Raley Indy/, attempt: water({}, (j) => (t) => ({ grab: between(0.2 + j, 0.7 + j)(t) })) },
];

let total = 0;
let landed = 0;
for (const c of CASES) {
  const results = JITTER.map((j) => {
    const { s, events } = c.attempt(j);
    return outcome(s, events);
  });
  const ok = results.filter((r) => c.want.test(r) && !r.startsWith('CRASH')).length;
  total += results.length;
  landed += ok;
  console.log(`${c.name.padEnd(22)} ${ok}/5  ${[...new Set(results)].join(' | ')}`);
}
console.log(`\n${landed}/${total} attempts landed the intended trick`);
