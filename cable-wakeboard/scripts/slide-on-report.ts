/**
 * Prints the side approach v2 spec's scripted scenarios (section 6.2): what
 * each should do and what it did.
 *   npx vite-node scripts/slide-on-report.ts
 */
import { judgeScenario, runScenario, SLIDE_ON_SCENARIOS } from '../tests/scenarios/slideOnScenarios';

console.log('| # | Scenario | Wanted | Result | OK |');
console.log('| --- | --- | --- | --- | --- |');
for (const sc of SLIDE_ON_SCENARIOS) {
  const r = runScenario(sc);
  const bad = judgeScenario(sc, r);
  const name = r.name || r.airName;
  const did = `${r.outcome}: ${r.reason ? `crash ${r.reason}` : name || r.note}${r.air > 0 ? `, ${r.air.toFixed(2)} s air` : ''}`;
  console.log(`| ${sc.id} | ${sc.what} | ${sc.outcome} | ${did} | ${bad ? `NO (${bad})` : 'yes'} |`);
}
