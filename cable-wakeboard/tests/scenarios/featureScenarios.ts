/**
 * The feature riding spec's scenario suite (section 12.2): scripted,
 * deterministic riders on each slide feature, 8 runs that must work and 8
 * that must fail with the right crash reason. A "pass" scenario may search a
 * small grid of timings and charges (a rider trying a few lines), and passes
 * if one of them does the trick cleanly; the table reports which one. Used by
 * tests/featureScenarios.test.ts and scripts/feature-ride-report.ts.
 */
import { makeConfig } from '../../src/sim/config';
import { toLocal } from '../../src/sim/features';
import type { SimEvent } from '../../src/sim/events';
import { type InputFrame, neutralInput } from '../../src/sim/input';
import { dot, rightOf } from '../../src/sim/math/vec';
import type { FeatureDef, ParkDef } from '../../src/sim/park';
import type { CrashReason, JibState } from '../../src/sim/rider';
import { stepSim } from '../../src/sim/step';
import { createSim, type SimState } from '../../src/sim/world';

export interface FeatureCase {
  name: string;
  def: FeatureDef;
  gap: boolean;
}

/** The slide features the suite runs on (the old defs and the wake park catalogue). */
export const FEATURES: FeatureCase[] = [
  { name: 'Box', def: { kind: 'slider', id: 'f', name: 'Box', style: 'box', s: 135, offset: 0, length: 8, width: 1, height: 0.5, entryLength: 3, safety: 'flush' }, gap: false },
  { name: 'Rail', def: { kind: 'slider', id: 'f', name: 'Rail', style: 'rail', s: 135, offset: 0, length: 8, width: 0.12, height: 0.5, entryLength: 3, safety: 'flush' }, gap: false },
  { name: 'Pipe', def: { kind: 'slider', id: 'f', name: 'Pipe', style: 'tube', s: 135, offset: 0, length: 10, width: 0.4, height: 0.5, entryLength: 2.5, safety: 'flush' }, gap: false },
  { name: 'Slider', def: { kind: 'feature', id: 'f', name: 'Slider', catalog: 'Slider', s: 135, offset: 0 } as FeatureDef, gap: false },
  { name: 'FlatRail', def: { kind: 'feature', id: 'f', name: 'FlatRail', catalog: 'FlatRail', s: 135, offset: 0 } as FeatureDef, gap: false },
  { name: 'PipeRail', def: { kind: 'feature', id: 'f', name: 'PipeRail', catalog: 'PipeRail', s: 135, offset: 0 } as FeatureDef, gap: false },
  { name: 'GapBox', def: { kind: 'feature', id: 'f', name: 'GapBox', catalog: 'GapBox', s: 135, offset: 0 } as FeatureDef, gap: true },
];

/** What a script sees each tick. */
export interface Ctx {
  s: SimState;
  t: number;
  /** Along the feature from the start of its main (m). */
  u: number;
  /** Across from its centre line (m). */
  v: number;
  /** Main length and half the slide width. */
  len: number;
  half: number;
  mode: SimState['rider']['mode'];
  /** Seconds since leaving the water / the feature into the air, -1 if not airborne. */
  air: number;
  /** The same, only in the air onto the feature (no exit yet) / off it (an exit air). */
  entryAir: number;
  exitAir: number;
  /** End of the safety, from the start of the main (m; negative). */
  safetyEnd: number;
  /** Along the main from where the rider got on (m), -1 off it. */
  mainU: number;
}

export interface RunOut {
  crash: CrashReason | null;
  jibs: JibState[];
  /** Out-spin of the line (deg), or null with no line air. */
  outDeg: number | null;
  name: string | null;
  modes: string[];
  events: SimEvent[];
}

const offsetDef = (def: FeatureDef, offset: number, yaw = 0): FeatureDef => ({ ...def, offset, yaw }) as FeatureDef;

/** Ride one scripted run (balance off, as in the spec's scripted tests; balance has its own tests). */
export function ride(def: FeatureDef, script: (c: Ctx) => Partial<InputFrame>, stance: 'regular' | 'goofy' = 'regular', seconds = 8): RunOut {
  const park: ParkDef = { name: 'scenario', features: [def] };
  const s = createSim(makeConfig({ feature: { balanceEnabled: false } }), park, 125);
  s.rider.stance = stance;
  const f = s.features[0]!;
  const mains = f.shape.pieces.filter((p) => p.slide && p.axis === 'u' && p.part === 1);
  const m0 = Math.min(...mains.map((p) => p.u0));
  const m1 = Math.max(...mains.map((p) => p.u1));
  const half = mains[0]!.width / 2;
  const safety = f.shape.pieces.find((p) => p.role === 'Safety');
  const safetyEnd = (safety ? safety.u1 : m0) - m0;
  const events: SimEvent[] = [];
  let airStart = -1;
  let mountU = -1;
  let done = false;
  for (let i = 0; i < seconds * 60 && !done; i++) {
    const t = i / 60;
    const l = toLocal(f, s.rider.pos);
    const mode = s.rider.mode;
    if (mode === 'airborne' && airStart < 0) airStart = t;
    if (mode !== 'airborne') airStart = -1;
    const air = airStart < 0 ? -1 : t - airStart;
    const exit = !!s.rider.air?.exit;
    if (mode === 'onFeature' && mountU < 0) mountU = l.u - m0;
    if (mode !== 'onFeature') mountU = -1;
    const ctx: Ctx = { s, t, u: l.u - m0, v: l.v, len: m1 - m0, half, mode, air, entryAir: exit ? -1 : air, exitAir: exit ? air : -1, safetyEnd, mainU: mountU < 0 ? -1 : l.u - m0 - mountU };
    stepSim(s, { ...neutralInput(), ...script(ctx) });
    for (const e of s.events) {
      events.push(e);
      if (e.type === 'crash' || e.type === 'featureLine') done = true;
    }
  }
  const crash = events.find((e) => e.type === 'crash');
  const line = events.find((e) => e.type === 'featureLine');
  const slides = events.flatMap((e) => (e.type === 'slideDone' ? [e.jib] : []));
  const fl = line?.type === 'featureLine' ? line : null;
  return {
    crash: crash?.type === 'crash' ? crash.reason : null,
    jibs: fl ? fl.exit.jibs : slides,
    outDeg: fl?.air ? Math.round(((fl.air.rot.spinAngle - fl.air.spinStart) * 180) / Math.PI) : null,
    name: null,
    modes: events.flatMap((e) => (e.type === 'transition' ? [e.to] : [])),
    events,
  };
}

const T = 1 / 60;
/** Space from `a` to `b` (s). */
const held = (c: Ctx, a: number, b: number) => c.t >= a && c.t < b;
/** On the main between two points (m from its start). */
const onMain = (c: Ctx, a: number, b: number) => c.mode === 'onFeature' && c.mainU >= a && c.mainU < b;
/** Within the last part of the main. */
const nearEnd = (c: Ctx, a: number, b: number) => c.mode === 'onFeature' && c.u >= c.len - a && c.u < c.len - b;

export interface Scenario {
  id: string;
  kind: 'pass' | 'fail';
  what: string;
  /** Returns '' on success or what went wrong, and a note on the line it used. */
  run: (fc: FeatureCase) => { ok: boolean; note: string } | null;
}

/** Try each candidate until one is ok. */
function search<T>(cands: T[], f: (c: T) => { ok: boolean; note: string }): { ok: boolean; note: string } {
  let last = { ok: false, note: 'no candidate' };
  for (const c of cands) {
    const r = f(c);
    if (r.ok) return r;
    last = r;
  }
  return { ok: false, note: last.note };
}
const grid = (a: number, b: number, step: number): number[] => {
  const out: number[] = [];
  for (let x = a; x <= b + 1e-9; x += step) out.push(Math.round(x * 1000) / 1000);
  return out;
};
const first = (r: RunOut) => r.jibs[0];
const desc = (r: RunOut) => (r.crash ? `crash ${r.crash}` : r.jibs.length ? `${r.jibs[0]!.entry} ${r.jibs[0]!.slideOrder.join('/')}` : 'no slide');

/** Side approach: the feature `gap` m beside the rider's line, on `side` (+1 the rider's right). */
function sideRun(fc: FeatureCase, side: 1 | -1, stance: 'regular' | 'goofy', gap: number, release: number, charge: number, turn: number, turnTime: number) {
  const probe = ride(fc.def, () => ({}), stance, 0.02);
  void probe;
  const halfW = FEATURES_HALF(fc);
  const def = offsetDef(fc.def, side * (halfW + gap));
  return ride(def, (c) => ({
    pop: c.mode === 'riding' && c.u >= release - charge * 8 && c.u < release,
    steer:
      (c.mode === 'riding' && c.u >= release - 0.12 && c.u < release + 0.2 ? side : 0) ||
      (c.entryAir >= T && c.entryAir < turnTime ? turn * side : 0) ||
      // Out of a boardslide: turn to fakie off the end so the line lands.
      (turn !== 0 && c.exitAir >= 0 && c.exitAir < 0.12 ? -side : 0),
  }), stance);
}
const halfCache = new Map<string, number>();
function FEATURES_HALF(fc: FeatureCase): number {
  const k = fc.name;
  if (!halfCache.has(k)) {
    const s = createSim(makeConfig(), { name: 'x', features: [fc.def] }, 125);
    const f = s.features[0]!;
    halfCache.set(k, Math.max(f.shape.vMax, -f.shape.vMin));
  }
  return halfCache.get(k)!;
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'P1', kind: 'pass', what: 'Front ollie-on with enough charge: 50-50',
    run: (fc) => search(grid(-5, -1.5, 0.5).flatMap((rel) => [0.25, 0.4, 0.5].map((ch) => [rel, ch] as const)), ([rel, ch]) => {
      const r = ride(fc.def, (c) => ({ pop: c.mode === 'riding' && c.u >= rel - ch * 8 && c.u < rel }));
      const j = first(r);
      return { ok: !r.crash && !!j && j.entry === 'ollieOn' && j.slideOrder[0] === 'fiftyFifty', note: `pop ${-rel} m before the main, ${ch} s: ${desc(r)}` };
    }),
  },
  ...([['heelside', -1, 'regular'], ['toeside', 1, 'regular']] as const).map(([side, dir, stance]): Scenario => ({
    id: `P2-${side}`, kind: 'pass', what: `Side ollie-on from the ${side}: 50-50`,
    run: (fc) => search(grid(0.4, 1.6, 0.2).flatMap((gap) => grid(-0.5, 2, 0.5).flatMap((rel) => [0.05, 0.15, 0.25].map((ch) => [gap, rel, ch] as const))), ([gap, rel, ch]) => {
      const r = sideRun(fc, dir, stance, gap, rel, ch, 0, 0);
      const j = first(r);
      return { ok: !r.crash && !!j && j.entry === 'sideOllieOn' && j.slideOrder[0] === 'fiftyFifty', note: `${gap} m beside, pop at ${rel} m, ${ch} s: ${desc(r)}` };
    }),
  })),
  ...([['heelside', -1, 'backboard'], ['toeside', 1, 'frontboard']] as const).map(([side, dir, want]): Scenario => ({
    id: `P3-${side}`, kind: 'pass', what: `Side ollie-on with a 90 from the ${side}: ${want === 'backboard' ? 'backside' : 'frontside'} boardslide`,
    run: (fc) => search(grid(0.4, 1.6, 0.2).flatMap((gap) => grid(-0.5, 2, 0.5).flatMap((rel) => [0.05, 0.15, 0.25].flatMap((ch) => [0.17, 0.2].map((tt) => [gap, rel, ch, tt] as const)))), ([gap, rel, ch, tt]) => {
      const r = sideRun(fc, dir, 'regular', gap, rel, ch, 1, tt);
      const j = first(r);
      return { ok: !r.crash && !!j && j.slideOrder[0] === want, note: `${gap} m beside, pop at ${rel} m, ${ch} s, turn ${tt} s: ${desc(r)}` };
    }),
  })),
  {
    id: 'P4', kind: 'pass', what: 'Ride up the safety (flush): 50-50',
    run: (fc) => {
      if (fc.gap) return null;
      const r = ride(fc.def, () => ({}));
      const j = first(r);
      return { ok: !r.crash && !!j && j.entry === 'rideOn' && j.slideOrder[0] === 'fiftyFifty', note: desc(r) };
    },
  },
  {
    id: 'P5', kind: 'pass', what: 'Ollie onto the safety, then pop in the window: onto the main',
    // Even a small ollie flies 5-6 m: hop from well before the safety, from beside it.
    run: (fc) => search(grid(0.4, 1.2, 0.2).flatMap((gap) => grid(-9, -4.5, 0.25).flatMap((rel) => [0.03, 0.08].map((ch) => [gap, rel, ch] as const))), ([gap, rel, ch]) => {
      const def = offsetDef(fc.def, FEATURES_HALF(fc) + gap);
      let landed = -1;
      const r = ride(def, (c) => {
        if (landed < 0 && c.mode === 'onSafety' && c.u < c.safetyEnd - 0.5) landed = c.t;
        return {
          pop: (c.mode === 'riding' && c.u >= rel - ch * 8 && c.u < rel) || (c.mode === 'onSafety' && c.u > c.safetyEnd - 0.5 && c.u < c.safetyEnd - 0.05 && landed >= 0),
          steer: c.mode === 'riding' && c.u >= rel - 0.12 && c.u < rel + 0.2 ? 1 : 0,
        };
      });
      const i = r.modes.indexOf('onSafety');
      const ok = !r.crash && i > 0 && r.modes[i - 1] === 'airborne' && r.modes[i + 1] === 'airborne' && r.modes[i + 2] === 'onFeature';
      return { ok, note: `${gap} m beside, hop at ${rel} m, ${ch} s: ${r.modes.slice(0, 5).join(' > ')}${r.crash ? ` (${r.crash})` : ''}` };
    }),
  },
  {
    id: 'P6', kind: 'pass', what: 'Pop off the safety with a 180-in: switch 50-50',
    // Released `rel` before the end of the safety.
    run: (fc) => search(grid(-0.6, -0.1, 0.1).flatMap((rel) => [0.2, 0.3, 0.4].flatMap((ch) => [0.25, 0.3].map((tt) => [rel, ch, tt] as const))), ([rel, ch, tt]) => {
      const r = ride(fc.def, (c) => ({ pop: c.mode === 'onSafety' && c.u >= c.safetyEnd + rel - ch * 8 && c.u < c.safetyEnd + rel, steer: c.entryAir >= T && c.entryAir < tt ? 1 : 0 }));
      const j = first(r);
      return { ok: !r.crash && !!j && (j.entry === 'popOn' || j.entry === 'pop') && j.slideOrder[0] === 'switchFiftyFifty', note: `pop ${-rel} m before the main, ${ch} s, turn ${tt} s: ${desc(r)}` };
    }),
  },
  ...([[-1, 'backboard'], [1, 'frontboard']] as const).map(([dir, want]): Scenario => ({
    id: `P7-${want === 'backboard' ? 'back' : 'front'}`, kind: 'pass', what: `50-50, then ${dir < 0 ? 'A' : 'D'} on the feature: ${want === 'backboard' ? 'backside' : 'frontside'} boardslide`,
    run: (fc) => {
      // Then ridden off the end and turned to fakie (or forward) so the line lands.
      const r = runOnto(fc, (c) => ({ steer: onMain(c, 0.2, 0.2 + 0.2 * 8) ? dir : c.exitAir >= 0 && c.exitAir < 0.12 ? -dir : 0 }));
      const j = first(r);
      return { ok: !r.crash && !!j && j.slideOrder.includes(want), note: desc(r) };
    },
  })),
  {
    id: 'P8-180', kind: 'pass', what: 'Exit: 180-out from a 50-50',
    run: (fc) => search([1, -1].flatMap((d) => [0.3, 0.35].map((tt) => [d, tt] as const)), ([d, tt]) => {
      const r = runOnto(fc, (c) => ({ pop: nearEnd(c, 1.6, 0.6), steer: c.exitAir >= T && c.exitAir < tt ? d : 0 }));
      return { ok: !r.crash && Math.abs(r.outDeg ?? 0) === 180, note: `${d > 0 ? 'D' : 'A'} ${tt} s: out ${r.outDeg}${r.crash ? ` (${r.crash})` : ''}` };
    }),
  },
  {
    id: 'P8-270', kind: 'pass', what: 'Exit: 270-out from a boardslide',
    run: (fc) => search([1, -1].flatMap((d) => [0.4, 0.45, 0.5].map((tt) => [d, tt] as const)), ([d, tt]) => {
      const r = runOnto(fc, (c) => ({ pop: nearEnd(c, 1.6, 0.6), steer: (onMain(c, 0.2, 1.7) ? -1 : 0) || (c.exitAir >= T && c.exitAir < tt ? d : 0) }));
      return { ok: !r.crash && Math.abs(r.outDeg ?? 0) === 270, note: `${d > 0 ? 'D' : 'A'} ${tt} s: out ${r.outDeg}${r.crash ? ` (${r.crash})` : ''}` };
    }),
  },
  {
    id: 'P8-fakie', kind: 'pass', what: 'Exit: a boardslide ridden off, turned to fakie',
    run: (fc) => search([1, -1].flatMap((d) => [0.12, 0.18].map((tt) => [d, tt] as const)), ([d, tt]) => {
      const r = runOnto(fc, (c) => ({ steer: (onMain(c, 0.2, 1.7) ? -1 : 0) || (c.exitAir >= 0 && c.exitAir < tt ? d : 0) }));
      return { ok: !r.crash && Math.abs(r.outDeg ?? 0) === 90 && r.s.rider.switchStance, note: `${d > 0 ? 'D' : 'A'} ${tt} s: out ${r.outDeg}${r.crash ? ` (${r.crash})` : ''}` };
    }),
  },
  {
    id: 'F1', kind: 'fail', what: 'Ollie too low for the front: ShortOllie',
    // A tap low on the safety (or from the water before it): too little height to clear the main's front.
    run: (fc) => search(grid(-8, -0.2, 0.1).flatMap((rel) => [0.02, 0.05].map((ch) => [rel, ch] as const)), ([rel, ch]) => {
      const r = ride(fc.def, (c) => ({ pop: (c.mode === 'riding' || c.mode === 'onSafety') && c.u >= rel - ch * 8 && c.u < rel }));
      return { ok: r.crash === 'shortOllie', note: `pop ${-rel} m before the main, ${ch} s: ${r.crash ?? desc(r)}` };
    }),
  },
  {
    // Side approach v2 spec 2: a little short scrapes up; well short the nose digs in (was ClippedSide).
    id: 'F2', kind: 'fail', what: 'Side ollie well short of the top: NoseDig',
    run: (fc) => search(grid(0.2, 2.0, 0.1).flatMap((gap) => grid(0, 4, 0.5).flatMap((rel) => [0.02, 0.05, 0.1].map((ch) => [gap, rel, ch] as const))), ([gap, rel, ch]) => {
      const r = sideRun(fc, 1, 'regular', gap, rel, ch, 0, 0);
      return { ok: r.crash === 'noseDig', note: `${gap} m beside, a ${ch} s tap at ${rel} m: ${r.crash ?? desc(r)}` };
    }),
  },
  {
    // Side approach v2 spec 2: steep is more air, never a crash (was NoseDig).
    id: 'F3', kind: 'pass', what: 'Side approach at 40 degrees: slides on (v2; was a NoseDig fail)',
    run: (fc) => search([[-1, 0.7], [1, -0.7]].flatMap(([side, yaw]) => [2, 2.5, 3, 3.5, 4].flatMap((off) => [3.0, 2.6, 2.8].map((t0) => [side!, yaw!, off, t0] as const))), ([side, yaw, off, t0]) => {
      const def = offsetDef(fc.def, side * off, yaw);
      const r = ride(def, (c) => ({ pop: held(c, t0, t0 + 0.3), steer: held(c, t0 + 0.3 - T, t0 + 0.3 + T) ? side : 0 }));
      return { ok: !r.crash && r.jibs[0]?.entry === 'slideOn', note: `${off} m ${side > 0 ? 'right' : 'left'}, turned 40 degrees: ${r.crash ?? desc(r)}` };
    }),
  },
  {
    // Side approach v2 spec 3 C/D: over the far side is a slide-off or a jump over (was Overshoot).
    id: 'F4', kind: 'pass', what: 'Side hop too strong: over it into the water, no crash (v2; was an Overshoot fail)',
    run: (fc) => search(grid(0.1, 0.8, 0.1).flatMap((gap) => grid(-0.5, 2, 0.5).flatMap((rel) => [0.1, 0.2, 0.3].map((ch) => [gap, rel, ch] as const))), ([gap, rel, ch]) => {
      const r = sideRun(fc, 1, 'regular', gap, rel, ch, 0, 0);
      return { ok: !r.crash && r.jibs.length === 0 && r.events.some((e) => e.type === 'landed' && !e.onFeature), note: `${gap} m beside, pop at ${rel} m, ${ch} s: ${r.crash ?? desc(r)}` };
    }),
  },
  {
    id: 'F5', kind: 'fail', what: 'Gap box with no pop: MissedSafetyPop / LandedInGap',
    run: (fc) => {
      if (!fc.gap) return null;
      const r = ride(fc.def, () => ({}));
      return { ok: r.crash === 'missedSafetyPop' || r.crash === 'landedInGap', note: r.crash ?? desc(r) };
    },
  },
  {
    // Side approach v2 spec 1: the edge loads the pop, it never slips out (was SlippedOut).
    id: 'F6', kind: 'pass', what: 'Hard edge held to takeoff on a backside entry: on, no SlippedOut (v2; was a fail)',
    run: (fc) => search(grid(0.6, 1.8, 0.2).flatMap((gap) => grid(-0.5, 2, 0.5).flatMap((rel) => [0.1, 0.2, 0.3, 0.4].map((ch) => [gap, rel, ch] as const))), ([gap, rel, ch]) => {
      const def = offsetDef(fc.def, -(FEATURES_HALF(fc) + gap));
      const r = ride(def, (c) => ({
        pop: c.mode === 'riding' && c.u >= rel - ch * 8 && c.u < rel,
        // Carving hard toward it (heelside edge) right up to the pop.
        steer: c.mode === 'riding' && c.u >= rel - 3 && c.u < rel + 0.2 ? -1 : 0,
      }));
      return { ok: !r.crash && r.jibs.length > 0, note: `${gap} m beside on the heelside, carving into the pop at ${rel} m: ${r.crash ?? desc(r)}` };
    }),
  },
  {
    id: 'F7', kind: 'fail', what: 'Backside rotation on the feature without Q: HandleDropped',
    run: (fc) => search([1, -1], (d) => {
      const r = runOnto(fc, (c) => ({ steer: onMain(c, 0.2, 8) ? d : 0 }));
      return { ok: r.crash === 'handleDropped', note: `${d > 0 ? 'D' : 'A'} held: ${r.crash ?? desc(r)}` };
    }),
  },
];

/** Rooftop at low speed (spec 12.2 fail 8): slowed with the rope slack on the up kink. */
export function rooftopStall(): { ok: boolean; note: string } {
  const def = { kind: 'feature', id: 'f', name: 'Rooftop', catalog: 'Rooftop', s: 135, offset: 0 } as FeatureDef;
  let done = false;
  const r = ride(def, (c) => {
    if (!done && c.mode === 'onFeature') {
      done = true;
      const v = c.s.rider.vel;
      const k = 1.5 / Math.hypot(v.x, v.y, v.z);
      c.s.rider.vel = { x: v.x * k, y: v.y * k, z: v.z * k };
      c.s.carrier.s -= 14;
    }
    return {};
  });
  return { ok: r.crash === 'stalled', note: `slowed to 1.5 m/s with the rope slack: ${r.crash ?? desc(r)}` };
}

/** Get onto the feature the easy way (ride up a flush safety; pop a gap one), then follow `script`. */
function runOnto(fc: FeatureCase, script: (c: Ctx) => Partial<InputFrame>): RunOut & { s: SimState } {
  let out: RunOut & { s: SimState } = null!;
  const park: ParkDef = { name: 'scenario', features: [fc.def] };
  const s = createSim(makeConfig({ feature: { balanceEnabled: false } }), park, 125);
  void park;
  void s;
  const r = ride(fc.def, (c) => {
    if (!out) out = { ...({} as RunOut), s: c.s };
    // A short pop at the end of a gap safety lands early on the main.
    const gapPop = fc.gap && c.mode === 'onSafety' && c.u >= c.safetyEnd - 0.4 && c.u < c.safetyEnd - 0.2;
    const own = script(c);
    return { ...own, pop: own.pop || gapPop };
  });
  return { ...r, s: out ? out.s : s };
}

export interface ScenarioRow {
  id: string;
  kind: 'pass' | 'fail';
  what: string;
  feature: string;
  ok: boolean;
  note: string;
}

/** Every scenario on every feature it applies to, plus the rooftop stall. */
export function runScenarioTable(): ScenarioRow[] {
  const rows: ScenarioRow[] = [];
  for (const sc of SCENARIOS) {
    for (const fc of FEATURES) {
      const r = sc.run(fc);
      if (r) rows.push({ id: sc.id, kind: sc.kind, what: sc.what, feature: fc.name, ok: r.ok, note: r.note });
    }
  }
  const st = rooftopStall();
  rows.push({ id: 'F8', kind: 'fail', what: 'Rooftop at low speed: Stalled', feature: 'Rooftop', ok: st.ok, note: st.note });
  return rows;
}

void dot;
void rightOf;
