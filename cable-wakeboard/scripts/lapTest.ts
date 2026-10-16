/**
 * Lap test (layout spec section 2): ride a park's cable with no features,
 * once with no input and three times weaving (edge to edge every 1.2, 1.6
 * and 2.4 s), and log how close the rider comes to any shore (the lake's
 * and the islands'), overall and near each tower. Used by tests/tower.test.ts
 * and `npx vite-node scripts/probe-lap-shore.ts`.
 */
import { distanceToOutline, distanceToSegment, pointInPolygon } from '../src/art/site';
import { neutralInput } from '../src/sim/input';
import type { GroundPoint, ParkDef } from '../src/sim/park';
import { createRun, stepRun } from '../src/sim/session';
import { DEFAULT_CONFIG } from '../src/sim/config';

export const LAP_POLICIES = ['none', 'weave 1.2 s', 'weave 1.6 s', 'weave 2.4 s'] as const;

export interface LapResult {
  policy: string;
  /** Closest the rider came to a shore (m; negative: on land). */
  minShore: number;
  /** Closest within 70 m of each tower's wheel. */
  perTower: number[];
  /** Closest to each tower's base (m). */
  perBase: number[];
  crashes: number;
}

/** Island shore edges: every island edge except the seams two islands share (the ring island is two halves). */
function islandShore(park: ParkDef): [GroundPoint, GroundPoint][] {
  // Either direction: the halves wind opposite ways or the same way.
  const key = (a: GroundPoint, b: GroundPoint) => [`${a.x},${a.z}`, `${b.x},${b.z}`].sort().join('|');
  const edges: [GroundPoint, GroundPoint][] = [];
  const seen = new Map<string, number>();
  for (const { outline } of park.site!.islands) {
    outline.forEach((a, i) => {
      const b = outline[(i + 1) % outline.length]!;
      edges.push([a, b]);
      seen.set(key(a, b), (seen.get(key(a, b)) ?? 0) + 1);
    });
  }
  return edges.filter(([a, b]) => seen.get(key(a, b)) === 1);
}

/** Signed distance from a point to the nearest shore (the lake's or an island's): + over water. */
export function shoreDistance(park: ParkDef, p: GroundPoint): number {
  const site = park.site!;
  const lake = (pointInPolygon(p, site.lake) ? 1 : -1) * distanceToOutline(p, site.lake);
  const onIsland = site.islands.some((i) => pointInPolygon(p, i.outline) || distanceToOutline(p, i.outline) < 1e-6);
  let di = Infinity;
  for (const [a, b] of islandShore(park)) di = Math.min(di, distanceToSegment(p, a, b));
  return onIsland ? Math.min(lake, -di) : Math.min(lake, di);
}

export function lapTest(park: ParkDef, seconds = 240): LapResult[] {
  const cable = { ...DEFAULT_CONFIG.cable, ...park.cable };
  const system = park.site!.cables?.find((c) => c.towers.every((t, i) => t.wheel.x === cable.towers[i]?.x && t.wheel.z === cable.towers[i]?.z));
  const towers = system?.towers ?? cable.towers.map((w) => ({ wheel: w, base: w, out: { x: 0, z: 0 }, arm: 0 }));
  return LAP_POLICIES.map((policy) => {
    const run = createRun(DEFAULT_CONFIG, { name: 'lap test', features: [], startS: park.startS, cable: park.cable, site: park.site });
    const res: LapResult = { policy, minShore: Infinity, perTower: towers.map(() => Infinity), perBase: towers.map(() => Infinity), crashes: 0 };
    const period = policy === 'none' ? 0 : Number(policy.split(' ')[1]);
    for (let i = 0; i < 60 * seconds && !run.finished; i++) {
      const inp = neutralInput();
      if (period) inp.steer = Math.sin(i / 60 / period) > 0 ? 1 : -1;
      stepRun(run, inp);
      if (run.sim.rider.mode === 'crashed' || i % 3) continue;
      const r = run.sim.rider.pos;
      const d = shoreDistance(park, r);
      res.minShore = Math.min(res.minShore, d);
      towers.forEach((t, k) => {
        if (Math.hypot(t.wheel.x - r.x, t.wheel.z - r.z) < 70) res.perTower[k] = Math.min(res.perTower[k]!, d);
        res.perBase[k] = Math.min(res.perBase[k]!, Math.hypot(t.base.x - r.x, t.base.z - r.z));
      });
    }
    res.crashes = run.crashes.length;
    return res;
  });
}
