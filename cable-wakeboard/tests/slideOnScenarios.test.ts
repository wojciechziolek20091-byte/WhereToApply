import { describe, expect, it } from 'vitest';
import { judgeSlideOnLine, runSlideOnLine, SLIDE_ON_LINES } from './scenarios/slideOnScenarios';

describe('slide-on scenarios (side approaches spec 8)', () => {
  for (const l of SLIDE_ON_LINES) {
    it(`${l.id} ${l.kind}: ${l.what}`, () => {
      expect(judgeSlideOnLine(l, runSlideOnLine(l))).toBe('');
    });
  }
});
