/**
 * SideApproachSweep (side approach v2 spec 6.1): a scripted rider through a
 * grid of side approaches on each reference feature, and the outcome of each
 * (A-F, spec 3). The rider is set by state a few ticks before the pop:
 * `lateral` m off the feature's near side (board centre to edge), turned
 * `angle` degrees in toward it at its current speed, its edge set to
 * `edge` (0..1 of the most, carving toward the feature) and held there, the
 * pop charged to `charge`, released `timing` s after the ideal point (it
 * rides on toward the feature meanwhile). W is held the first 0.2 s of the
 * air for the W nose lift. Used by scripts/side-approach-sweep.ts and
 * tests/sideApproachSweep.test.ts.
 */
import { makeConfig, type SimConfig } from '../../src/sim/config';
import type { SimEvent } from '../../src/sim/events';
import { toLocal } from '../../src/sim/features';
import { type InputFrame, neutralInput } from '../../src/sim/input';
import { forwardOf, rightOf } from '../../src/sim/math/vec';
import type { FeatureDef, ParkDef } from '../../src/sim/park';
import type { CrashReason, JibEntry } from '../../src/sim/rider';
import { stepSim } from '../../src/sim/step';
import { createSim, type SimState } from '../../src/sim/world';
import { sidePopSpeed } from '../../src/sim/featureRide/slideOnConfig';
import { featureTrickName } from '../../src/sim/featureRide/featureTrickNamer';
import { classifyAir } from '../../src/sim/tricks/classify';

const deg = (d: number): number => (d * Math.PI) / 180;
/** The scripted rider's top speed cutting in (m/s). */
const MAX_CUT_SPEED = 11;

const box = (name: string, height: number, width: number, o: Partial<Extract<FeatureDef, { kind: 'slider' }>> = {}): FeatureDef => ({
  kind: 'slider', id: 'f', name, style: 'box', s: 135, offset: -3, length: 8, width, height, entryLength: 3, safety: 'flush', ...o,
});

export interface SweepFeature {
  name: string;
  def: FeatureDef;
}

/** The spec's reference features (section 5). */
export const SWEEP_FEATURES: SweepFeature[] = [
  { name: 'table 0.30', def: box('Table', 0.3, 1.2) },
  { name: 'box 0.50', def: box('Box', 0.5, 1.0) },
  { name: 'ledge 0.80', def: box('Ledge', 0.8, 1.0, { sideType: 'Coping' }) },
  { name: 'pipe 0.63', def: box('Pipe', 0.63, 0.4, { style: 'tube', length: 10, entryLength: 2.5 }) },
  { name: 'kanted 0.65', def: box('Kanted', 0.65, 0.5, { sideType: 'Kanted' }) },
  { name: 'rail 0.60', def: box('Rail', 0.6, 0.12, { style: 'rail' }) },
];

export type Outcome = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'N';

export interface SweepInput {
  angle: number;
  lateral: number;
  charge: number;
  edge: number;
  w: boolean;
  timing: number;
  /** +1 the feature on the rider's toeside (right of travel for a regular rider), -1 heelside. */
  side: 1 | -1;
  stance?: 'regular' | 'goofy';
  /** A/D for the first 0.5 s on the feature, away from it (counter-steer). */
  counter?: boolean;
  /** Spin in the air: A/D held this long (s), away from the feature (spinDir -1, the default) or further into the turn (+1). */
  spin?: number;
  spinDir?: 1 | -1;
}

export interface SweepResult {
  outcome: Outcome;
  reason: CrashReason | null;
  entry: JibEntry | null;
  sketchy: boolean;
  /** Air time before touching anything (s) and the slides held. */
  air: number;
  slides: string;
  /** What happened, in a few words. */
  note: string;
  /** The line's name so far (the entry and the slide), '' when it never got on. */
  name: string;
  /** The trick named for the air when it landed in the water (an "Ollie Over"), '' otherwise. */
  airName: string;
  /** The approach tracker's slide-on block at the pop ('' available, 'none' no approach). */
  block: string;
  events: SimEvent[];
}

/**
 * In a copy of the sim: hold the line (`line` sets the heading, speed and
 * edge each tick) and charge for `chargeTicks`, pop, then fly with no
 * features (only the air and the rope). How far toward the feature the board
 * has moved from here when it comes back down through `height` (null when
 * it never gets there).
 */
function chargeAndPopArc(
  s: SimState,
  chargeTicks: number,
  steer: number,
  line: (c: SimState) => void,
  height: number,
  rightOfAxis: { x: number; z: number },
  toward: number,
): number | null {
  const c = structuredClone(s);
  const x0 = c.rider.pos.x;
  const z0 = c.rider.pos.z;
  for (let k = 0; k < chargeTicks; k++) {
    if (c.rider.mode !== 'riding' && c.rider.mode !== 'waterTrickLoad') return null;
    line(c);
    stepSim(c, { ...neutralInput(), pop: true, steer });
  }
  let rose = false;
  for (let k = 0; k < 240; k++) {
    if (c.rider.mode === 'riding' || c.rider.mode === 'waterTrickLoad') line(c);
    stepSim(c, { ...neutralInput() });
    // The pop itself sees the feature (the side approach's pop); after it, only the air and the rope.
    if (k === 0) {
      (c as { features: unknown[] }).features = [];
      if (c.rider.air) c.rider.air.slideOn = null;
    }
    const r = c.rider;
    if (r.mode === 'crashed') return null;
    if (r.pos.y > height) rose = true;
    if (rose && r.vel.y < 0 && r.pos.y <= height) return toward * ((r.pos.x - x0) * rightOfAxis.x + (r.pos.z - z0) * rightOfAxis.z);
    if (r.mode !== 'airborne') return null;
  }
  return null;
}

/**
 * Run one side approach. The rider is set up `lateral` m off the side,
 * turned `angle` in, edge set, and rides in holding that line (a scripted
 * rider) until the ideal pop point: where the pop, with the edge's release,
 * brings the nose to the edge a little before the top of its arc. The pop is
 * charged to `charge` for that moment and released `timing` s after it.
 */
export function runSideApproach(
  def: FeatureDef,
  inp: SweepInput,
  cfg: SimConfig = makeConfig({ feature: { balanceEnabled: false } }),
  trace?: (s: SimState) => void,
): SweepResult {
  const a = deg(inp.angle);
  const tanA = Math.tan(a);
  // Ride in far enough that the board meets the side about 2 m into the main.
  const rideIn = a > 0.01 ? Math.min(30, inp.lateral / tanA) : 0;
  const shift = Math.max(0, rideIn - 6);
  const park: ParkDef = { name: 'sweep', features: [{ ...def, s: def.s + shift } as FeatureDef] };
  const s = createSim(cfg, park, 125);
  const r = s.rider;
  r.stance = inp.stance ?? 'regular';
  const f = s.features[0]!;
  const mains = f.shape.pieces.filter((p) => p.slide && p.axis === 'u' && p.part === 1);
  const m0 = Math.min(...mains.map((p) => p.u0));
  const half = mains[0]!.width / 2;
  // World side the feature is on (+1 right of travel) and the edge that carves toward it.
  const toes = r.stance === 'regular' ? 1 : -1;
  const worldSide = inp.side * toes;
  const edgeSign = -worldSide * toes;
  const placeU = m0 + 2 - rideIn;
  const chargeTicks = Math.max(1, Math.round((inp.charge * cfg.ollie.chargeTime) / (1 / 60)));
  const lateTicks = Math.round(inp.timing * 60);
  const S = cfg.slideOn;
  // The scripted rider holds the line: turned in toward the feature, keeping up with the carrier along
  // the line (a cut speeds the rider up, to 11 m/s at most), edge set toward it.
  const holdLine = (c: SimState): void => {
    const cr = c.rider;
    cr.heading = f.heading + worldSide * a;
    const sp = Math.min(speed / Math.max(0.05, Math.cos(a)), MAX_CUT_SPEED);
    cr.vel = { x: Math.cos(cr.heading) * sp, y: 0, z: Math.sin(cr.heading) * sp };
    cr.edgeAngle = edgeSign * inp.edge * cfg.edge.maxEdgeAngle;
  };
  const events: SimEvent[] = [];
  let placed = -1;
  let ideal = -1;
  let holdFrom = -1;
  let release = -1;
  let speed = 0;
  let airStart = -1;
  let mountTick = -1;
  let leftWater = false;
  let crash: CrashReason | null = null;
  let entry: JibEntry | null = null;
  let sketchy = false;
  let air = 0;
  let slides = '';
  let farSide = false;
  let landedWater = false;
  let block = 'none';
  let slidOff = false;
  let nextAim = 0;
  let name = '';
  for (let i = 0; i < 60 * 16; i++) {
    const l = toLocal(f, r.pos);
    const fw = forwardOf(f.heading);
    const rt = rightOf(f.heading);
    if (placed < 0 && r.mode === 'riding' && l.u >= placeU) {
      placed = i;
      speed = Math.hypot(r.vel.x, r.vel.z);
      // Beside the main (centred on the axis here).
      const vv = worldSide > 0 ? -half - inp.lateral : half + inp.lateral;
      r.pos = { x: f.origin.x + fw.x * l.u + rt.x * vv, y: 0, z: f.origin.z + fw.z * l.u + rt.z * vv };
    }
    const riding = placed >= 0 && (r.mode === 'riding' || r.mode === 'waterTrickLoad') && release < 0 ? true : placed >= 0 && i < release;
    if (riding && (r.mode === 'riding' || r.mode === 'waterTrickLoad')) {
      holdLine(s);
      let continueAim = false;
      if (ideal < 0) {
        const gap = worldSide > 0 ? -half - toLocal(f, r.pos).v : toLocal(f, r.pos).v - half;
        const load = inp.edge * Math.min(S.EdgeTensionMax, Math.max(S.EdgeTensionMin, r.ropeTension / S.EdgeTensionRef));
        const vin = Math.min(speed / Math.max(0.05, Math.cos(a)), MAX_CUT_SPEED) * Math.sin(a) + S.EdgeReleaseBonus * load;
        const vy = sidePopSpeed(inp.charge, cfg, load);
        // The nose reaches the edge at 0.8 of the time to the top of the arc; a pop that clears the
        // top instead aims to come down on its centre line.
        const top = mains[0]!.h0;
        const peak = (vy * vy) / (2 * 9.81);
        const tLand = peak > top + cfg.featureRide.Entry.Clearance ? (vy + Math.sqrt(vy * vy - 2 * 9.81 * top)) / 9.81 : 0;
        const want = vin * 0.8 * (vy / 9.81) + (S.BoardLength / 2) * Math.sin(a);
        if (tLand > 0 && a > 0.01) {
          // The arc clears the top: start charging when a simulated charge-and-pop (the rope lifts it
          // too) brings the board down on the top's centre line.
          // Every 3 ticks, every tick near the point.
          if (i >= nextAim) {
            // The charge still to come (it may have started before the set-up point).
            const remaining = holdFrom >= 0 ? Math.max(0, holdFrom + chargeTicks - i) : chargeTicks;
            const across = chargeAndPopArc(s, remaining, inp.edge > 0 ? worldSide * inp.edge : 0, holdLine, top, rt, worldSide);
            nextAim = i + (across !== null && across >= gap + half - 1.5 ? 1 : 3);
            if (across !== null && across >= gap + half) {
              ideal = i;
              if (holdFrom < 0) holdFrom = i;
              release = i + remaining + lateTicks;
            }
          }
          // Not yet there: keep riding in, unless the slide-on's own point has come.
          continueAim = ideal < 0 && gap > want;
        }
        if (!continueAim && ideal < 0) {
        const vIn = Math.min(speed / Math.max(0.05, Math.cos(a)), MAX_CUT_SPEED) * Math.sin(a);
        const tti = vin > 0.05 ? (gap - want) / (vIn > 0.05 ? vIn : 1e9) : 0;
        if (holdFrom < 0 && tti <= chargeTicks / 60) holdFrom = i;
        if (gap <= want || a < 0.01) {
          ideal = i;
          if (holdFrom < 0) holdFrom = i;
          // Released at the ideal point, once the charge is in (set up too close, it goes as soon as it can), plus the late timing.
          release = (a < 0.01 || i > placed ? Math.max(i, holdFrom + chargeTicks) : Math.max(i, holdFrom + 1)) + lateTicks;
        }
        }
      }
    }
    // Before the set-up point: charge early when the ideal point will come sooner than the charge takes.
    if (placed < 0 && holdFrom < 0 && r.mode === 'riding') {
      const sp = Math.hypot(r.vel.x, r.vel.z);
      const load0 = inp.edge * 0.7;
      const vin0 = sp * Math.sin(a) + S.EdgeReleaseBonus * load0;
      const want0 = vin0 * 0.8 * (sidePopSpeed(inp.charge, cfg, load0) / 9.81) + (S.BoardLength / 2) * Math.sin(a);
      const vy0 = sidePopSpeed(inp.charge, cfg, load0);
      const clears = (vy0 * vy0) / (2 * 9.81) > mains[0]!.h0 + cfg.featureRide.Entry.Clearance;
      // A pop that clears the top charges up during the set-up, before turning in.
      const tIdeal = a > 0.01 && !clears ? Math.max(0, (inp.lateral - want0) / (sp * Math.sin(a))) : 0;
      const lead = chargeTicks / 60 - tIdeal;
      if (lead > 0 && l.u >= placeU - sp * lead) holdFrom = i;
    }
    const input: Partial<InputFrame> = {};
    if (holdFrom >= 0 && (release < 0 || i < release)) input.pop = true;
    // Hold the edge into the pop (analogue steer toward the feature).
    if (riding && inp.edge > 0) input.steer = worldSide * inp.edge;
    if (release >= 0 && i >= release) {
      const inAir = r.mode === 'airborne';
      if (inAir && airStart < 0) airStart = i;
      const t = airStart >= 0 ? (i - airStart) / 60 : -1;
      if (inp.w && inAir && t >= 0 && t < 0.2) input.forward = true;
      if (inp.spin && inAir && t >= 0 && t < inp.spin && !r.air?.exit) input.steer = (inp.spinDir ?? -1) * worldSide;
      if (inp.counter && r.mode === 'onFeature' && mountTick >= 0 && i - mountTick < 30) input.steer = -worldSide;
    }
    stepSim(s, { ...neutralInput(), ...input });
    trace?.(s);
    for (const e of s.events) events.push(e);
    if (release >= 0 && i === release - 1) block = r.approach ? r.approach.slideOnBlock : 'none';
    // A coyote pop (or any takeoff) before the release counts as the release.
    if (release >= 0 && i < release && r.mode === 'airborne') release = i;
    if (release >= 0 && i >= release) {
      if (r.mode === 'airborne' || r.mode === 'onFeature' || r.mode === 'onSafety' || r.mode === 'onKicker') leftWater = true;
      const c = s.events.find((e) => e.type === 'crash');
      if (c && c.type === 'crash') {
        crash = c.reason;
        break;
      }
      if (r.mode === 'onFeature' && mountTick < 0 && r.jib) {
        mountTick = i;
        entry = r.jib.entry;
        sketchy = r.jib.sketchy;
        air = airStart >= 0 ? (i - airStart) / 60 : 0;
      }
      if (r.air?.exit?.kind === 'slideOff') slidOff = true;
      if (mountTick >= 0 && r.jib) {
        sketchy = sketchy || r.jib.sketchy;
        slides = r.jib.slideOrder.join(',');
        name = featureTrickName([r.jib], null);
      }
      if (mountTick >= 0 && i - mountTick > 45) break;
      // Left it some other way (off the end, a pop): the side approach is done; the exit is the line's business.
      if (mountTick >= 0 && r.air?.exit && r.air.exit.kind !== 'slideOff') break;
      if (leftWater && (r.mode === 'landing' || r.mode === 'riding')) {
        landedWater = true;
        const lv = toLocal(f, r.pos).v;
        // The rider started at -v when the feature was on its right.
        farSide = worldSide > 0 ? lv > half : lv < -half;
        if (airStart >= 0 && mountTick < 0) air = (i - airStart) / 60;
        break;
      }
    } else {
      const c = s.events.find((e) => e.type === 'crash');
      if (c && c.type === 'crash') {
        crash = c.reason;
        break;
      }
    }
  }
  let outcome: Outcome;
  let note: string;
  if (crash) {
    outcome = 'F';
    note = mountTick >= 0 ? `crash after mounting (${entry}): ${crash}` : `crash: ${crash}`;
  } else if (mountTick >= 0) {
    const side = entry === 'sideOllieOn' || entry === 'ollieOn' || entry === 'transfer';
    outcome = sketchy ? 'E' : side ? 'B' : 'A';
    note = `${entry}${sketchy ? ' sketchy' : ''} ${slides}`;
    if (landedWater && slidOff) {
      outcome = 'C';
      note = `slid off (${entry})`;
    }
  } else if (landedWater && farSide) {
    outcome = 'D';
    note = 'over the feature';
  } else {
    outcome = 'N';
    note = landedWater ? 'back in the water on the near side' : 'never reached it';
  }
  const landed = events.find((e) => e.type === 'landed' && !e.onFeature);
  const airName = landed && landed.type === 'landed' && mountTick < 0 ? (classifyAir(landed.air, landed.landing, cfg)?.name ?? '') : '';
  return { outcome, reason: crash, entry, sketchy, air, slides, note, name, airName, block, events };
}

export const SWEEP_GRID = {
  angle: [0, 5, 10, 20, 30, 45, 60, 75],
  lateral: [0.3, 1.0, 2.0, 3.0],
  charge: [0.25, 0.5, 0.75, 1.0],
  edge: [0, 0.5, 1.0],
  w: [false, true],
  timing: [0, 0.08, 0.15],
};

export interface SweepRow extends SweepInput {
  feature: string;
  result: SweepResult;
}

/** The whole grid on every feature (both sides when `bothSides`). */
export function runSweep(features = SWEEP_FEATURES, bothSides = false): SweepRow[] {
  const rows: SweepRow[] = [];
  const G = SWEEP_GRID;
  for (const f of features)
    for (const side of bothSides ? ([-1, 1] as const) : ([-1] as const))
      for (const angle of G.angle)
        for (const lateral of G.lateral)
          for (const charge of G.charge)
            for (const edge of G.edge)
              for (const w of G.w)
                for (const timing of G.timing) {
                  const inp: SweepInput = { angle, lateral, charge, edge, w, timing, side };
                  rows.push({ feature: f.name, ...inp, result: runSideApproach(f.def, inp) });
                }
  return rows;
}
