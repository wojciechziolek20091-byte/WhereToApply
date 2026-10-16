/**
 * Layout spec section 2: towers on land, out of the riding area. The tower
 * part lists of src/art/tower.ts and TowerBuilder.luau match; towers build
 * under the Roblox mock with CanCollide / CanQuery off; every base is on land
 * 9.5 m (8 m + the foundation) or more from water; and the lap test keeps
 * riders 10 m from every shore on both cable systems.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { distanceToOutline, pointInPolygon } from '../src/art/site';
import { towerParts } from '../src/art/tower';
import { DEFAULT_CONFIG } from '../src/sim/config';
import { BEGINNER_PARK, WAKE_PARK } from '../src/sim/parkLayout';
import { lapTest, shoreDistance } from '../scripts/lapTest';
import { bundleShared } from './parity/luauBundle';

const LUAU = process.env.LUAU;
const site = WAKE_PARK.site!;
const H = DEFAULT_CONFIG.cable.cableHeight;
const groundAt = (x: number, z: number) => site.islands.find((i) => pointInPolygon({ x, z }, i.outline))?.height ?? 0.6;

describe('cable towers', () => {
  it('both systems are on the site: five loop towers and two beginner towers', () => {
    expect(site.cables!.map((c) => [c.name, c.mode, c.towers.length])).toEqual([['Main loop', 'loop', 5], ['Beginner line', 'twoTower', 2]]);
    expect(site.cables![0]!.towers.map((t) => t.wheel)).toEqual(WAKE_PARK.cable!.towers);
    expect(site.cables![1]!.towers.map((t) => t.wheel)).toEqual(BEGINNER_PARK.cable!.towers);
  });

  it('every tower base is on land, 9.5 m or more from any water', () => {
    for (const t of site.cables!.flatMap((c) => c.towers)) {
      expect(shoreDistance(WAKE_PARK, t.base)).toBeLessThan(-9.5);
      // Its guy wire anchors are on land too.
      for (const p of towerParts(t, H, groundAt(t.base.x, t.base.z)).filter((q) => q.name === 'Anchor')) {
        expect(shoreDistance(WAKE_PARK, { x: p.a[0], z: p.a[2] })).toBeLessThan(0);
      }
    }
  });

  it('lap test: riders keep 10 m from every shore, round every corner, on both systems', { timeout: 120000 }, () => {
    for (const park of [WAKE_PARK, BEGINNER_PARK]) {
      for (const r of lapTest(park)) {
        expect(r.crashes).toBe(0);
        expect(r.minShore).toBeGreaterThanOrEqual(10);
        // And 18 m or more from a tower base (8 m of land plus the 10 m margin).
        for (const d of r.perBase) expect(d).toBeGreaterThan(18);
      }
    }
  });

  it('features and the start dock are clear of the towers', () => {
    const bases = site.cables!.flatMap((c) => c.towers.map((t) => t.base));
    for (const b of bases) expect(distanceToOutline(b, site.lake)).toBeGreaterThan(9.5);
  });
});

describe.skipIf(!LUAU)('cable towers in Luau', () => {
  const run = (spec: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'tower-'));
    const file = join(dir, 't.luau');
    writeFileSync(file, [readFileSync(join(__dirname, '../roblox/tests/mock_roblox.luau'), 'utf8'), bundleShared([], ['Sim', 'Park']), spec].join('\n'));
    return execFileSync(LUAU!, [file], { encoding: 'utf8', maxBuffer: 1 << 26 });
  };

  it('TowerBuilder.towerParts matches src/art/tower.ts', () => {
    const towers = site.cables!.flatMap((c) => c.towers);
    const out = run(`
local TB = require(__root.Park.TowerBuilder)
local Sim = require(__root.Sim)
for _, c in Sim.ParkLayout.WAKE_PARK.site.cables do
  for _, t in c.towers do
    for _, p in TB.towerParts(t, ${H}, 0.6) do
      print(p.name, p.kind, p.role, string.format("%.6f %.6f %.6f %.6f %.6f %.6f %.6f", p.a[1], p.a[2], p.a[3], p.b[1], p.b[2], p.b[3], p.r))
    end
  end
end`);
    const ts = towers.flatMap((t) => towerParts(t, H, 0.6)).map((p) => [p.name, p.kind, p.role, [...p.a, ...p.b, p.r].map((v) => v.toFixed(6)).join(' ')].join('\t'));
    expect(out.trimEnd().split('\n')).toEqual(ts);
  });

  it('builds every tower: styled, anchored, no collision or queries, tagged CableTower', () => {
    const out = run(`
local TB = require(__root.Park.TowerBuilder)
local Sim = require(__root.Sim)
local CollectionService = game:GetService("CollectionService")
local folder = TB.buildSite(Sim.ParkLayout.WAKE_PARK.site, ${H}, function() return 0.6 end)
local n, bad = 0, 0
for _, m in folder:GetChildren() do
  assert(CollectionService:HasTag(m, "CableTower"), "tag")
  for _, p in m:GetDescendants() do
    if p:IsA("BasePart") then
      n += 1
      if p.CanCollide ~= false or p.CanQuery ~= false or p.Anchored ~= true or p:GetAttribute("StyleRole") == nil then bad += 1 end
    end
  end
end
print(#folder:GetChildren(), n, bad)`);
    const [models, parts, bad] = out.trim().split(/\s+/).map(Number);
    expect(models).toBe(7);
    expect(parts).toBe(7 * 11);
    expect(bad).toBe(0);
  });
});
