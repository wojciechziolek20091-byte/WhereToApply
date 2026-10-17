import { describe, expect, it } from 'vitest';
import { runScenarioTable } from './scenarios/featureScenarios';

// The feature riding spec's scenario suite (12.2) on every slide feature; the
// table itself: npx vite-node scripts/feature-ride-report.ts
describe('feature riding scenarios (spec 12.2)', () => {
  it('every pass scenario works and every fail scenario fails with its crash reason, on every slide feature', () => {
    const rows = runScenarioTable();
    const bad = rows.filter((r) => !r.ok).map((r) => `${r.id} ${r.feature}: ${r.note}`);
    expect(bad).toEqual([]);
    expect(new Set(rows.map((r) => r.id)).size).toBe(21);
    expect(rows.length).toBeGreaterThanOrEqual(130);
  }, 600000);
});
