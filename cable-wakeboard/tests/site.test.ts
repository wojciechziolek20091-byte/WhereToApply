import {
  distanceToOutline,
  growRadially,
  isStarShaped,
  pointInPolygon,
  polygonArea,
  triangulate,
} from '../src/art/site';
import { buildCablePath, cablePointAt } from '../src/sim/cable';
import { DEFAULT_CONFIG } from '../src/sim/config';
import { featureLength } from '../src/sim/park';
import { DEFAULT_PARK } from '../src/sim/park';
import { createSim } from '../src/sim/world';

const site = DEFAULT_PARK.site!;
const path = buildCablePath(DEFAULT_CONFIG.cable);
const towers = DEFAULT_CONFIG.cable.towers;
const nearTower = (p: { x: number; z: number }, r: number) => towers.some((t) => Math.hypot(t.x - p.x, t.z - p.z) < r);

describe('lakeside park site', () => {
  it('lake outline is star-shaped (the land ring and forest rely on it)', () => {
    expect(isStarShaped(site.lake)).toBe(true);
  });

  it('keeps the shore at least 12 m from the cable away from the towers', () => {
    for (let s = 0; s < path.length; s += 1) {
      const p = cablePointAt(path, s).pos;
      if (nearTower(p, 22)) continue;
      expect(pointInPolygon(p, site.lake)).toBe(true);
      expect(distanceToOutline(p, site.lake)).toBeGreaterThan(12);
    }
  });

  it('keeps the island at least 18 m from the cable and inside the lake', () => {
    const island = site.islands[0]!.outline;
    for (const p of island) expect(pointInPolygon(p, site.lake)).toBe(true);
    for (let s = 0; s < path.length; s += 1) {
      expect(distanceToOutline(cablePointAt(path, s).pos, island)).toBeGreaterThan(18);
    }
  });

  it('puts every feature in open water, clear of the island and the shore', () => {
    const sim = createSim();
    for (const f of sim.features) {
      const fwd = { x: Math.cos(f.heading), z: Math.sin(f.heading) };
      for (const t of [0, 0.5, 1]) {
        const p = { x: f.origin.x + fwd.x * featureLength(f.def) * t, z: f.origin.z + fwd.z * featureLength(f.def) * t };
        expect(pointInPolygon(p, site.lake)).toBe(true);
        expect(distanceToOutline(p, site.lake)).toBeGreaterThan(5);
        expect(pointInPolygon(p, site.islands[0]!.outline)).toBe(false);
        expect(distanceToOutline(p, site.islands[0]!.outline)).toBeGreaterThan(8);
      }
    }
  });

  it('features follow the map order along the lap and do not overlap', () => {
    const feats = [...DEFAULT_PARK.features].sort((a, b) => a.s - b.s);
    for (let i = 0; i + 1 < feats.length; i++) {
      const a = feats[i]!;
      expect(a.s + featureLength(a)).toBeLessThan(feats[i + 1]!.s);
    }
    expect(DEFAULT_PARK.features.filter((f) => f.kind === 'kicker')).toHaveLength(8);
    expect(DEFAULT_PARK.features.filter((f) => f.kind === 'slider')).toHaveLength(4);
  });

  it('starts the rider at the starting dock, on land nowhere', () => {
    const sim = createSim();
    const dock = site.docks[0]!;
    // Rider spawns alongside the dock, within its length.
    const s0 = sim.carrier.s - path.length * Math.floor(sim.carrier.s / path.length);
    expect(s0).toBe(DEFAULT_PARK.startS);
    let best = { d: Infinity, s: 0 };
    for (let s = 0; s < path.length; s += 0.25) {
      const p = cablePointAt(path, s).pos;
      const d = Math.hypot(p.x - sim.rider.pos.x, p.z - sim.rider.pos.z);
      if (d < best.d) best = { d, s };
    }
    expect(best.s).toBeGreaterThanOrEqual(dock.s);
    expect(best.s).toBeLessThanOrEqual(dock.s + dock.length + 1);
    expect(pointInPolygon(sim.rider.pos, site.lake)).toBe(true);
  });

  it('places buildings on land', () => {
    for (const b of site.buildings) {
      expect(pointInPolygon(b, site.lake)).toBe(false);
      expect(distanceToOutline(b, site.lake)).toBeGreaterThan(Math.max(b.width, b.depth) / 2);
    }
  });
});

describe('site geometry helpers', () => {
  const square = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }];
  const ell = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 4 }, { x: 4, z: 4 }, { x: 4, z: 10 }, { x: 0, z: 10 }];

  it('triangulates simple polygons into the right area', () => {
    for (const poly of [square, ell, site.lake, site.islands[0]!.outline, site.areas[0]!.outline]) {
      const tris = triangulate(poly);
      expect(tris).toHaveLength(poly.length - 2);
      const area = tris.reduce((a, [i, j, k]) => a + Math.abs(polygonArea([poly[i]!, poly[j]!, poly[k]!])), 0);
      expect(area).toBeCloseTo(Math.abs(polygonArea(poly)), 6);
    }
  });

  it('tests points and star shape', () => {
    expect(pointInPolygon({ x: 2, z: 2 }, ell)).toBe(true);
    expect(pointInPolygon({ x: 8, z: 8 }, ell)).toBe(false);
    expect(isStarShaped(square)).toBe(true);
    expect(Math.abs(polygonArea(growRadially(square, 2)))).toBeGreaterThan(100);
  });
});
