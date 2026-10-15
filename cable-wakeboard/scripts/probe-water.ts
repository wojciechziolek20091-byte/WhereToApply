/** Ad-hoc: water tricks off a heelside cut. npx vite-node scripts/probe-water.ts */
import type { InputFrame } from '../src/sim/input';
import { classifyAir } from '../src/sim/tricks/classify';
import { cutAndPop, flatSim, untilTouchdown } from '../tests/helpers';

function trick(label: string, releaseAt: number, opts: { back?: boolean; forward?: boolean }, air: (t: number) => Partial<InputFrame> = () => ({})) {
  const s = flatSim();
  const before = s.rider;
  void before;
  const take = cutAndPop(s, { releaseAt, ...opts });
  const tension = s.rider.air?.tensionAtTakeoff ?? 0;
  const t = s.rider.air?.trick;
  const e = untilTouchdown(s, air);
  const desc = e.type === 'landed' ? `landed "${classifyAir(e.air, e.landing, s.cfg)?.name}" air ${e.air.time.toFixed(2)} s peak ${e.air.peakHeight.toFixed(2)} m` : e.type === 'crash' ? `CRASH ${e.reason}` : e.type;
  console.log(`${label.padEnd(18)} release ${releaseAt.toFixed(2)}  ${take?.type === 'takeoff' ? take.source : 'no takeoff'}  T ${tension.toFixed(0)} N  timing ${t?.timing.toFixed(2)}  plan h ${t?.height.toFixed(2)} m  -> ${desc}`);
}
for (const r of [1.0, 1.2, 1.35, 1.5, 1.65, 1.9]) trick('raley', r, {});
trick('backroll', 1.45, { back: true });
trick('frontroll', 1.45, { forward: true });
trick('raley + D early', 1.45, {}, (t) => ({ steer: t > 0.15 && t < 0.25 ? 1 : 0 }));
for (const at of [0.3, 0.4, 0.5, 0.6]) trick(`S-bend @${at}`, 1.45, {}, (t) => ({ steer: t > at && t < at + 0.1 ? 1 : 0 }));
trick('backroll + spin', 1.45, { back: true }, (t) => ({ steer: t < 0.6 ? 1 : 0, pass: t > 0.2 && t < 0.25 }));
trick('raley + grab', 1.45, {}, (t) => ({ grab: t > 0.2 && t < 0.7 }));
