/**
 * LayoutValidator (layout spec section 1): checks a park's layout against
 * the real-park rules (LAYOUT_RULES) and returns a pass / fail table, one row
 * per feature and rule. Twin: roblox/src/shared/Park/LayoutValidator.luau
 * (tests/layout.test.ts checks they agree).
 *
 *   const rows = validateLayout(WAKE_PARK, WAKE_LAYOUT);
 *   console.log(formatLayoutTable(rows));
 */
import { distanceToOutline, distanceToSegment, pointInPolygon, polygonArea } from '../art/site';
import { buildCablePath, cablePointAt } from '../sim/cable';
import { DEFAULT_CONFIG } from '../sim/config';
import { FEATURE_CATALOG } from '../sim/featureCatalog';
import { type GroundPoint, type ParkDef, resolvePark } from '../sim/park';
import { cableStraights, LAYOUT_RULES, offsetCategory, type ParkLayoutEntry, travelCable } from '../sim/parkLayout';

export interface LayoutRow {
  feature: string;
  rule: string;
  pass: boolean;
  value: string;
  limit: string;
}

const f1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1);

/** Island shore edges: every island edge except the seams two islands share (the ring island is two halves). */
function islandShore(park: ParkDef): [GroundPoint, GroundPoint][] {
  const key = (a: GroundPoint, b: GroundPoint) => [`${a.x},${a.z}`, `${b.x},${b.z}`].sort().join('|');
  const edges: [GroundPoint, GroundPoint][] = [];
  const seen = new Map<string, number>();
  for (const { outline } of park.site?.islands ?? []) {
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

/** Do two convex polygons overlap (separating axis test)? */
function overlaps(a: GroundPoint[], b: GroundPoint[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]!;
      const q = poly[(i + 1) % poly.length]!;
      const nx = -(q.z - p.z);
      const nz = q.x - p.x;
      const proj = (ps: GroundPoint[]) => ps.map((r) => r.x * nx + r.z * nz);
      const pa = proj(a);
      const pb = proj(b);
      if (Math.max(...pa) <= Math.min(...pb) || Math.max(...pb) <= Math.min(...pa)) return false;
    }
  }
  return true;
}

/** Distance from a point to a convex polygon (0 inside). */
function distanceToPoly(p: GroundPoint, poly: GroundPoint[]): number {
  return pointInPolygon(p, poly) ? 0 : distanceToOutline(p, poly);
}

interface Placed {
  entry: ParkLayoutEntry;
  foot: GroundPoint[];
  approach: GroundPoint[];
  runOut: GroundPoint[];
  startAlong: number;
  endAlong: number;
  centreLat: number;
  s0: number;
  yaw: number;
  kicker: boolean;
}

export function validateLayout(park: ParkDef, entries: ParkLayoutEntry[], rules = LAYOUT_RULES, beginner = false): LayoutRow[] {
  const cable = travelCable({ ...DEFAULT_CONFIG.cable, ...park.cable }, rules.direction);
  const path = buildCablePath(cable);
  const straights = cableStraights(cable);
  const resolved = resolvePark(park, path);
  const rows: LayoutRow[] = [];
  const row = (feature: string, rule: string, pass: boolean, value: string, limit: string) => rows.push({ feature, rule, pass, value, limit });

  if (cable.mode !== 'twoTower') {
    const ccw = polygonArea(cable.towers) < 0;
    const want = rules.direction === 'CounterClockwise';
    row('park', 'Direction', ccw === want, ccw ? 'CounterClockwise' : 'Clockwise', rules.direction);
  }

  const placed: Placed[] = entries.map((e) => {
    const f = resolved.find((r) => r.def.id === e.featureId);
    if (!f) throw new Error(`${e.featureId} is not in ${park.name}`);
    const st = straights[e.straight - 1]!;
    const sh = f.shape;
    const fx = Math.cos(f.heading);
    const fz = Math.sin(f.heading);
    const at = (u: number, v: number): GroundPoint => ({ x: f.origin.x + fx * u - fz * v, z: f.origin.z + fz * u + fx * v });
    const kicker = FEATURE_CATALOG[e.type]!.meta.tag === 'Kicker';
    const ro = kicker ? rules.runOut.Kicker : rules.runOut.Other;
    const w = 1;
    const foot = [at(sh.uMin, sh.vMin), at(sh.uMax, sh.vMin), at(sh.uMax, sh.vMax), at(sh.uMin, sh.vMax)];
    // The straight's frame: along from its start, lateral to the right of travel.
    const p0 = path.segments.find((g) => g.kind === 'line' && Math.abs(g.s0 - st.s0) < 1e-6)!;
    const start = p0.kind === 'line' ? p0.start : { x: 0, y: 0, z: 0 };
    const hx = Math.cos(p0.kind === 'line' ? p0.heading : 0);
    const hz = Math.sin(p0.kind === 'line' ? p0.heading : 0);
    const along = foot.map((q) => (q.x - start.x) * hx + (q.z - start.z) * hz);
    const lats = foot.map((q) => -(q.x - start.x) * hz + (q.z - start.z) * hx);
    return {
      entry: e,
      foot,
      approach: [at(sh.uMin - rules.approach, sh.vMin - w), at(sh.uMin, sh.vMin - w), at(sh.uMin, sh.vMax + w), at(sh.uMin - rules.approach, sh.vMax + w)],
      runOut: [at(sh.uMax, sh.vMin - w), at(sh.uMax + ro, sh.vMin - w), at(sh.uMax + ro, sh.vMax + w), at(sh.uMax, sh.vMax + w)],
      startAlong: Math.min(...along),
      endAlong: Math.max(...along),
      centreLat: (Math.min(...lats) + Math.max(...lats)) / 2,
      s0: st.s0,
      yaw: f.def.yaw ?? 0,
      kicker,
    };
  });

  const docks = park.site?.docks ?? [];
  const towerBases = (park.site?.cables ?? []).flatMap((c) => c.towers.map((t) => t.base));
  const buoys = (park.site?.buoys ?? []) as GroundPoint[];
  // Dock footprints on the water.
  const dockFeet = docks.map((d) => {
    const a = cablePointAt(path, d.s);
    const b = cablePointAt(path, d.s + d.length);
    const r = (p: typeof a, off: number) => ({ x: p.pos.x - Math.sin(p.heading) * off, z: p.pos.z + Math.cos(p.heading) * off });
    return [r(a, d.offset - d.width / 2), r(b, d.offset - d.width / 2), r(b, d.offset + d.width / 2), r(a, d.offset + d.width / 2)];
  });
  for (const p of placed) {
    const e = p.entry;
    const id = e.featureId;
    const L = straights[e.straight - 1]!.length;
    // Band and corner zones.
    const lo = rules.band[0] * L;
    const hi = rules.band[1] * L;
    row(id, 'Band 20-80 %', p.startAlong >= lo - 1e-6 && p.endAlong <= hi + 1e-6, `${f1(p.startAlong)}-${f1(p.endAlong)}`, `${f1(lo)}-${f1(hi)}`);
    const cornerOk = cable.mode === 'twoTower' || (p.startAlong >= rules.cornerAfter && p.endAlong <= L - rules.cornerBefore);
    row(id, 'Corner zones', cornerOk, `${f1(p.startAlong)} after / ${f1(L - p.endAlong)} before`, `${rules.cornerAfter} / ${rules.cornerBefore}`);
    // The cable after the start dock.
    for (const d of docks) {
      const lap = path.shuttle ? Infinity : path.length;
      let dist = p.s0 + p.startAlong - (d.s + d.length);
      if (Number.isFinite(lap)) dist = ((dist % lap) + lap) % lap;
      row(id, 'Start clear', dist >= rules.startClear, `${f1(dist)} after ${d.name}`, `${rules.startClear}`);
    }
    // Spacing, sides: against the next feature on the same straight.
    const same = placed.filter((q) => q.entry.straight === e.straight).sort((a, b) => a.startAlong - b.startAlong);
    const k = same.indexOf(p);
    const next = same[k + 1];
    if (next) {
      const gap = next.startAlong - p.endAlong;
      const need = Math.max(rules.spacing[0], (p.kicker ? rules.runOut.Kicker : rules.runOut.Other) + rules.approach);
      row(id, 'Spacing', gap >= need && gap <= rules.spacing[1], `${f1(gap)} to ${next.entry.featureId}`, `${need}-${rules.spacing[1]}`);
      row(id, 'Alternating sides', next.entry.side !== e.side, `${e.side} then ${next.entry.side}`, 'L/R');
    }
    // Offset, angle in.
    const cat = offsetCategory(e.type, beginner);
    const [o0, o1] = rules.offsets[cat]!;
    const lat = Math.abs(p.centreLat);
    row(id, 'Offset', lat >= o0 - 0.3 && lat <= o1 + 0.3 && e.sideOffset >= o0 && e.sideOffset <= o1 && Math.sign(p.centreLat) === (e.side === 'R' ? 1 : -1), `${f1(lat)} (${e.side}, ${cat})`, `${o0}-${o1}`);
    const deg = (Math.abs(p.yaw) * 180) / Math.PI;
    const toward = Math.sign(p.yaw) === (e.side === 'R' ? -1 : 1);
    row(id, 'Angle in', deg >= rules.angleIn[0] - 1e-6 && deg <= rules.angleIn[1] + 1e-6 && toward, `${f1(deg)} deg${toward ? '' : ' (outward)'}`, `${rules.angleIn[0]}-${rules.angleIn[1]}`);
    // Reachable: the centre within rope length of the cable line.
    row(id, 'Reach', Math.abs(p.centreLat) <= DEFAULT_CONFIG.rope.length, f1(Math.abs(p.centreLat)), `${DEFAULT_CONFIG.rope.length}`);
    // Run-out and approach clear of other features, buoys, docks and towers.
    const others = placed.filter((q) => q !== p);
    const blocker = (zone: GroundPoint[]): string => {
      const f = others.find((q) => overlaps(zone, q.foot));
      if (f) return f.entry.featureId;
      if (buoys.some((b) => pointInPolygon(b, zone))) return 'buoy';
      if (dockFeet.some((d) => overlaps(zone, d))) return 'dock';
      if (towerBases.some((b) => pointInPolygon(b, zone))) return 'tower';
      return 'clear';
    };
    const run = blocker(p.runOut);
    row(id, 'Run-out clear', run === 'clear', run, `${p.kicker ? rules.runOut.Kicker : rules.runOut.Other} m`);
    const app = blocker(p.approach);
    row(id, 'Approach clear', app === 'clear', app, `${rules.approach} m`);
    // Shore, towers, buoys.
    if (park.site) {
      const shore = Math.min(...p.foot.map((q) => shoreDistance(park, q)));
      row(id, 'Shore', shore >= rules.shore, f1(shore), `${rules.shore}`);
    }
    if (towerBases.length) {
      const tb = Math.min(...towerBases.map((b) => distanceToPoly(b, p.foot)));
      row(id, 'Tower bases', tb >= rules.towerBase, f1(tb), `${rules.towerBase}`);
    }
    if (buoys.length) {
      const bd = Math.min(...buoys.map((b) => distanceToPoly(b, p.foot)));
      row(id, 'Buoys', bd >= rules.buoyClear, f1(bd), `${rules.buoyClear}`);
    }
  }
  return rows;
}

/** The table as text: one line per row, failures marked. */
export function formatLayoutTable(rows: LayoutRow[]): string {
  const w = Math.max(...rows.map((r) => r.feature.length));
  const lines = rows.map((r) => `${r.pass ? 'PASS' : 'FAIL'}  ${r.feature.padEnd(w)}  ${r.rule.padEnd(17)}  ${r.value.padEnd(26)}  ${r.limit}`);
  const failed = rows.filter((r) => !r.pass).length;
  return `${lines.join('\n')}\n${rows.length - failed} passed, ${failed} failed`;
}
