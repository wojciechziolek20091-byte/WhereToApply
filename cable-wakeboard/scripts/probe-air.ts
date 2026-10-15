/** Ad-hoc: ollie heights and spin/handle behaviour. npx vite-node scripts/probe-air.ts */
import { neutralInput } from '../src/sim/input';
import { stepSim } from '../src/sim/step';
import { flatSim, run } from '../tests/helpers';

function ollie(hold: number, input: (t: number) => Partial<ReturnType<typeof neutralInput>> = () => ({})) {
  const s = flatSim();
  run(s, 3);
  run(s, hold, () => ({ pop: true }));
  const out: string[] = [];
  for (let i = 0; i < 300; i++) {
    stepSim(s, { ...neutralInput(), ...input(i / 60) });
    for (const e of s.events) {
      if (e.type === 'takeoff') out.push(`takeoff v${e.popSpeed.toFixed(2)}`);
      if (e.type === 'landed') out.push(`landed air ${e.air.time.toFixed(2)} s peak ${e.air.peakHeight.toFixed(2)} spin ${((e.air.rot.spinAngle * 180) / Math.PI).toFixed(0)} side ${e.air.rot.spinSide} passes ${e.air.rot.passes} handle ${s.rider.handle} clean ${e.landing.clean}`);
      if (e.type === 'crash') out.push(`crash ${e.reason}`);
      if (e.type === 'handlePass') out.push(`pass at ${(i / 60).toFixed(2)}`);
    }
    if (s.events.some((e) => e.type === 'landed' || e.type === 'crash')) break;
  }
  return out.join(' | ');
}
console.log('tap ollie    ', ollie(0.02));
console.log('full ollie   ', ollie(0.6));
console.log('D 180 (BS)   ', ollie(0.6, (t) => ({ steer: t < 0.25 ? 1 : 0 })));
console.log('A 180 (FS)   ', ollie(0.6, (t) => ({ steer: t < 0.25 ? -1 : 0 })));
console.log('D held (BS)  ', ollie(0.6, () => ({ steer: 1 })));
console.log('A held (FS)  ', ollie(0.6, () => ({ steer: -1 })));
for (const q of [0.1, 0.15, 0.2, 0.25, 0.3]) console.log(`BS 360 Q@${q}`, ollie(0.6, (t) => ({ steer: t < 0.62 ? 1 : 0, pass: t > q && t < q + 0.05 })));
for (const q of [0.25, 0.3, 0.35, 0.4]) console.log(`FS 360 Q@${q}`, ollie(0.6, (t) => ({ steer: t < 0.62 ? -1 : 0, pass: t > q && t < q + 0.05 })));
console.log('W front flip', ollie(0.6, (t) => ({ forward: t < 0.7 })));
console.log('S tantrum   ', ollie(0.6, (t) => ({ back: t < 0.7 })));
