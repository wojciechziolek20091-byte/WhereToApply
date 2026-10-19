/**
 * The side approach v2 spec's scripted scenarios (section 6.2): each must
 * produce exactly its outcome (A-F, spec 3). Run on the SideApproachSweep's
 * scripted rider (tests/scenarios/sideApproachSweep.ts). Used by
 * tests/slideOnScenarios.test.ts and scripts/slide-on-report.ts.
 */
import type { FeatureDef } from '../../src/sim/park';
import { type Outcome, runSideApproach, type SweepInput, type SweepResult } from './sideApproachSweep';

const box = (name: string, height: number, width: number): FeatureDef => ({
  kind: 'slider', id: 'f', name, style: 'box', s: 135, offset: -3, length: 8, width, height, entryLength: 3, safety: 'flush',
});
const TABLE = box('Table', 0.3, 1.2);
const BOX = box('Box', 0.5, 1.0);
const NARROW = box('Narrow box', 0.5, 0.6);
const LEDGE = { ...box('Ledge', 0.8, 1.0), sideType: 'Coping' } as FeatureDef;

export interface SlideOnScenario {
  id: string;
  what: string;
  def: FeatureDef;
  input: SweepInput;
  outcome: Outcome;
  /** The line's name must contain this (on the feature), or the air's name (over it). */
  name?: string;
  check?: (r: SweepResult) => string;
}

const heel = -1 as const;
const toe = 1 as const;
export const SLIDE_ON_SCENARIOS: SlideOnScenario[] = [
  { id: '1', what: 'heelside edge, 20 degrees, charge 0.5, table 0.30: Slide-on 50-50', def: TABLE, input: { angle: 20, lateral: 1, charge: 0.5, edge: 0.5, w: false, timing: 0, side: heel }, outcome: 'A', name: 'Slide-on 50-50' },
  { id: '2', what: 'toeside edge, 25 degrees, charge 0.75, box 0.50: Slide-on', def: BOX, input: { angle: 25, lateral: 1, charge: 0.75, edge: 0.5, w: false, timing: 0, side: toe }, outcome: 'A', name: 'Slide-on' },
  {
    id: '3', what: 'heelside edge at full load, 45 degrees, charge 1.0, box 0.50: Side Ollie-on 50-50 with air', def: BOX,
    input: { angle: 45, lateral: 6, charge: 1, edge: 1, w: false, timing: 0, side: heel }, outcome: 'B', name: 'Side Ollie-on 50-50',
    check: (r) => (r.air >= 0.35 ? '' : `only ${r.air.toFixed(2)} s of air`),
  },
  { id: '4', what: 'the same with a 90 in the air: Backside ... Boardslide (feature on the heelside)', def: BOX, input: { angle: 45, lateral: 6, charge: 1, edge: 1, w: false, timing: 0, side: heel, spin: 0.1, spinDir: 1 }, outcome: 'B', name: 'Backside' },
  { id: '5', what: '70 degrees, full charge, narrow box: Ollie Over, into the water', def: NARROW, input: { angle: 70, lateral: 4, charge: 1, edge: 1, w: false, timing: 0, side: heel }, outcome: 'D', name: 'Ollie Over' },
  { id: '6', what: '60 degrees, medium charge, narrow box, no counter-steer: slides off the far side', def: NARROW, input: { angle: 60, lateral: 1, charge: 0.5, edge: 0.5, w: false, timing: 0, side: heel }, outcome: 'C' },
  { id: '7', what: 'the same with counter-steer: stays on top', def: NARROW, input: { angle: 60, lateral: 1, charge: 0.5, edge: 0.5, w: false, timing: 0, side: heel, counter: true }, outcome: 'A' },
  { id: '8', what: 'ledge 0.80, W held, charge 0.75, 20 degrees: Slide-on', def: LEDGE, input: { angle: 20, lateral: 1, charge: 0.75, edge: 0.5, w: true, timing: 0, side: heel }, outcome: 'A' },
  {
    id: '9', what: 'edge fully loaded at the pop: never SlippedOut', def: BOX, input: { angle: 20, lateral: 1, charge: 0.75, edge: 1, w: false, timing: 0, side: heel }, outcome: 'A',
    check: (r) => (r.reason === 'slippedOut' ? 'slipped out' : ''),
  },
  { id: '10', what: 'ledge 0.80, charge 0.1, no W: NoseDig', def: LEDGE, input: { angle: 20, lateral: 1, charge: 0.1, edge: 0, w: false, timing: 0, side: heel }, outcome: 'F', check: (r) => (r.reason === 'noseDig' ? '' : `crash ${r.reason}`) },
];

/** '' when the scenario does what it should, else what it did. */
export function judgeScenario(sc: SlideOnScenario, r: SweepResult): string {
  if (r.outcome !== sc.outcome) return `${r.outcome} (${r.note})`;
  const name = r.name || r.airName;
  if (sc.name && !name.includes(sc.name)) return `named "${name}"`;
  return sc.check ? sc.check(r) : '';
}

export const runScenario = (sc: SlideOnScenario): SweepResult => runSideApproach(sc.def, sc.input);
