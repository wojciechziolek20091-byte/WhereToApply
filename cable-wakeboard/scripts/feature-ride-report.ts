// Print the feature riding scenario suite (spec 12.2): a matrix of scenarios
// by feature, then every run with the line it used.
//   npx vite-node scripts/feature-ride-report.ts
import { runScenarioTable } from '../tests/scenarios/featureScenarios';

const rows = runScenarioTable();
const features = [...new Set(rows.map((r) => r.feature))];
const ids = [...new Set(rows.map((r) => r.id))];
console.log(`| Scenario | ${features.join(' | ')} |`);
console.log(`|---|${features.map(() => '---').join('|')}|`);
for (const id of ids) {
  const what = rows.find((r) => r.id === id)!.what;
  const cells = features.map((f) => {
    const r = rows.find((x) => x.id === id && x.feature === f);
    return r ? (r.ok ? 'pass' : '**FAIL**') : 'n/a';
  });
  console.log(`| ${id} ${what} | ${cells.join(' | ')} |`);
}
console.log(`\n${rows.filter((r) => r.ok).length}/${rows.length} runs pass\n`);
console.log('| Scenario | Feature | Result | Line used / outcome |');
console.log('|---|---|---|---|');
for (const r of rows) console.log(`| ${r.id} | ${r.feature} | ${r.ok ? 'pass' : 'FAIL'} | ${r.note} |`);
