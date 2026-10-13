// Kicker probe: hit k1 with different pop release offsets relative to leaving the lip.
import { createSim } from '../src/sim/world';
import { stepSim } from '../src/sim/step';
import { neutralInput } from '../src/sim/input';

function firstLipTick(): number {
  const s = createSim();
  for (let t = 0; t < 60 * 20; t++) {
    stepSim(s, neutralInput());
    if (s.events.some((e) => e.type === 'takeoff')) return t;
  }
  return -1;
}
const lip = firstLipTick();
console.log('lip tick', lip);
for (const offset of [null, -40, -20, -10, -5, -3, 0]) {
  const s = createSim();
  const inp = neutralInput();
  let out = '';
  for (let t = 0; t < 60 * 20; t++) {
    inp.load = offset !== null && t >= lip + offset - 24 && t < lip + offset;
    stepSim(s, inp);
    for (const e of s.events) {
      if (e.type === 'takeoff') out += `${e.source} pop ${e.popSpeed.toFixed(2)} vy ${s.rider.vel.y.toFixed(2)} `;
      if (e.type === 'landed') out += `air ${e.air.time.toFixed(2)} peak ${e.air.peakHeight.toFixed(2)} impact ${e.landing.impact.toFixed(1)}`;
      if (e.type === 'fall') out += `FALL ${e.kind}`;
    }
    if (out.includes('air ') || out.includes('FALL')) break;
  }
  console.log('release offset', offset, out);
}
