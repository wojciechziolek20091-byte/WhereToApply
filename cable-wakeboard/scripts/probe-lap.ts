// Ride two passes of the default park with no input and print what happens.
import { createRun, stepRun } from '../src/sim/session';
import { neutralInput } from '../src/sim/input';
const run = createRun();
let maxSlack = 0;
for (let i = 0; i < 60 * 200 && !run.finished; i++) {
  stepRun(run, neutralInput());
  maxSlack = Math.max(maxSlack, run.sim.rider.slackTime);
  for (const e of run.sim.events) if (e.type !== 'featureEnter' && e.type !== 'featureExit' && e.type !== 'takeoff') console.log(run.sim.time.toFixed(1), e.type, 'kind' in e ? e.kind : '', 'stretchRate' in e ? e.stretchRate.toFixed(1) : '');
  for (const t of run.latest) console.log('   trick', t.trick.name, t.height.toFixed(2));
}
console.log('finished', run.endReason, 'tricks', run.tricks.length, 'falls', run.falls.length, 'maxSlack', maxSlack.toFixed(2));
console.log(JSON.stringify(run.score));
