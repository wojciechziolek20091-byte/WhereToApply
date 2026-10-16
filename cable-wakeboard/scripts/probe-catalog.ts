/**
 * Rides each wake park catalogue feature on the cable line and prints what
 * happens: modes, takeoffs, landings, slides, crashes. A tuning aid for the
 * features spec; `npx vite-node scripts/probe-catalog.ts [name] [popAt]`.
 */
import { FEATURE_CATALOG } from '../src/sim/featureCatalog';
import { makeConfig } from '../src/sim/config';
import { neutralInput } from '../src/sim/input';
import { stepSim } from '../src/sim/step';
import { createSim } from '../src/sim/world';
import { toLocal } from '../src/sim/features';

const only = process.argv[2];
const popAt = process.argv[3] ? Number(process.argv[3]) : -1;
// Optional steering: "from,to,dir" in metres along the feature (u), e.g. "-14,1,1".
const steerArg = process.argv[4] ? process.argv[4].split(',').map(Number) : null;
const offset = process.argv[5] ? Number(process.argv[5]) : 0;
for (const name of Object.keys(FEATURE_CATALOG)) {
  if (only && only !== 'all' && name !== only) continue;
  const s = createSim(makeConfig({ feature: { balanceEnabled: false } }), { name: 'probe', features: [{ kind: 'feature', id: name, name, catalog: name, s: 135, offset }] }, 125);
  const f = s.features[0]!;
  const log: string[] = [];
  let peak = 0;
  let airStart = -1;
  for (let i = 0; i < 60 * 8; i++) {
    const t = i / 60;
    const l = toLocal(f, s.rider.pos);
    const pop = popAt >= 0 && l.u > popAt - 1.5 && l.u < popAt && s.rider.mode !== 'airborne';
    const steer = steerArg && l.u > steerArg[0]! && l.u < steerArg[1]! && s.rider.mode !== 'airborne' ? steerArg[2]! : 0;
    stepSim(s, { ...neutralInput(), pop, steer });
    if (s.rider.air) peak = Math.max(peak, s.rider.pos.y);
    for (const e of s.events) {
      if (e.type === 'transition') log.push(`${t.toFixed(2)} ${e.from}->${e.to} (${e.reason}) u=${toLocal(f, s.rider.pos).u.toFixed(2)} y=${s.rider.pos.y.toFixed(2)}`);
      if (e.type === 'takeoff') airStart = t;
      if (e.type === 'landed') log.push(`   landed air=${(t - airStart).toFixed(2)}s peak=${peak.toFixed(2)} src=${e.air.source} feature=${e.onFeature}`);
      if (e.type === 'crash') log.push(`   CRASH ${e.reason}`);
      if (e.type === 'slideDone') log.push(`   slide ${e.jib.entry} ${e.jib.time.toFixed(2)}s ${e.jib.slideOrder.join('/')}`);
    }
    if (s.rider.mode === 'onFeature' && name === 'WallRide' && i % 3 === 0) log.push(`     wall u=${l.u.toFixed(2)} v=${l.v.toFixed(2)} y=${s.rider.pos.y.toFixed(2)}`);
    if (s.rider.mode === 'crashed') break;
  }
  console.log(`== ${name}\n${log.join('\n')}`);
}
