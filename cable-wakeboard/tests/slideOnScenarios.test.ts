import { describe, expect, it } from 'vitest';
import { judgeScenario, runScenario, SLIDE_ON_SCENARIOS } from './scenarios/slideOnScenarios';

describe('side approach scenarios (side approach v2 spec 6.2)', () => {
  for (const sc of SLIDE_ON_SCENARIOS) {
    it(`${sc.id}: ${sc.what}`, () => {
      expect(judgeScenario(sc, runScenario(sc))).toBe('');
    });
  }
});
