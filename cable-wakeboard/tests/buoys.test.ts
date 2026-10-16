/**
 * Layout spec section 5: buoys from the BuoyLayout. Rings of 6-8 over the
 * water round every tower, a white lane out of each start dock (every 8 m
 * for 40 m, both sides), markers off the shore hazards; all in open water,
 * none within 6 m of a feature or in an approach / run-out (LayoutValidator);
 * and in Luau: balls 40 % under, no collision, tagged, bobbing +-5 cm, a
 * splash when ridden through.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shoreDistance, validateLayout } from '../src/park/layoutValidator';
import { BEGINNER_LINE, BEGINNER_PARK, WAKE_LAYOUT, WAKE_PARK } from '../src/sim/parkLayout';
import { bundleShared } from './parity/luauBundle';

const LUAU = process.env.LUAU;

describe('BuoyLayout', () => {
  for (const park of [WAKE_PARK, BEGINNER_PARK]) {
    const buoys = park.site!.buoyLayout!;
    it(`${park.name}: 6-8 orange 1.2 m buoys round every tower`, () => {
      for (const system of park.site!.cables!) {
        system.towers.forEach((_, k) => {
          const ring = buoys.filter((b) => b.marks === `${system.name} tower ${k + 1}`);
          expect(ring.length).toBeGreaterThanOrEqual(6);
          expect(ring.length).toBeLessThanOrEqual(8);
          for (const b of ring) expect([b.kind, b.diameter]).toEqual(['Boundary', 1.2]);
        });
      }
    });

    it(`${park.name}: a white 0.8 m lane out of the start dock, 5 pairs`, () => {
      const lane = buoys.filter((b) => b.kind === 'Lane');
      expect(lane).toHaveLength(10);
      for (const b of lane) expect(b.diameter).toBe(0.8);
    });

    it(`${park.name}: every buoy in open water, and the validator's buoy rows pass`, () => {
      for (const b of buoys) expect(shoreDistance(park, b)).toBeGreaterThan(b.diameter / 2 + 1.5);
      expect(park.site!.buoys).toEqual(buoys.map((b) => ({ x: b.x, z: b.z })));
      const rows = validateLayout(park, park === WAKE_PARK ? WAKE_LAYOUT : BEGINNER_LINE, undefined, park === BEGINNER_PARK);
      const buoyRows = rows.filter((r) => r.rule === 'Buoys' || r.rule === 'Run-out clear' || r.rule === 'Approach clear');
      expect(buoyRows.length).toBeGreaterThan(0);
      expect(buoyRows.filter((r) => !r.pass)).toEqual([]);
    });
  }
});

describe.skipIf(!LUAU)('buoys in Luau', () => {
  it('builds balls 40 % under the water, styled, no collision, tagged; they bob +-5 cm and splash when ridden through', () => {
    const dir = mkdtempSync(join(tmpdir(), 'buoy-'));
    const file = join(dir, 'b.luau');
    writeFileSync(file, [readFileSync(join(__dirname, '../roblox/tests/mock_roblox.luau'), 'utf8'), bundleShared([], ['Sim', 'Park']), `
local Buoys = require(__root.Park.Buoys)
local Sim = require(__root.Sim)
local CollectionService = game:GetService("CollectionService")
local S = 3.57
local site = Sim.ParkLayout.WAKE_PARK.site
local folder = Buoys.build(site)
local bad, n = 0, 0
for _, m in folder:GetChildren() do
  n += 1
  local ball = m.PrimaryPart
  local d = m:GetAttribute("Diameter")
  if not CollectionService:HasTag(m, "Buoy") or ball.Shape ~= Enum.PartType.Ball or math.abs(ball.CFrame.Position.Y / S - d * 0.1) > 1e-6 then bad += 1 end
  for _, p in m:GetChildren() do
    if p:IsA("BasePart") and (p.CanCollide ~= false or p.CanQuery ~= false or p:GetAttribute("StyleRole") == nil) then bad += 1 end
  end
end
-- Bob: sample one buoy over a period.
local m = folder:GetChildren()[1]
local y0 = m.PrimaryPart.CFrame.Position.Y
local lo, hi = math.huge, -math.huge
for i = 0, 400 do Buoys.step(i / 100) local y = m.PrimaryPart.CFrame.Position.Y - y0 lo = math.min(lo, y) hi = math.max(hi, y) end
-- Ride through the first buoy.
local b = site.buoyLayout[1]
local hit = Buoys.step(10, Vector3.new(b.x * S, 0, b.z * S))
print(n, bad, string.format("%.4f %.4f", lo / S, hi / S), hit[1], #Buoys.step(10.2, Vector3.new(b.x * S, 0, b.z * S)))`].join('\n'));
    const [n, bad, lo, hi, id, again] = execFileSync(LUAU!, [file], { encoding: 'utf8' }).trim().split(/\s+/);
    expect(Number(n)).toBe(WAKE_PARK.site!.buoyLayout!.length);
    expect(Number(bad)).toBe(0);
    expect(Number(hi) - Number(lo)).toBeCloseTo(0.1, 2);
    expect(id).toBe(WAKE_PARK.site!.buoyLayout![0]!.id);
    expect(Number(again)).toBe(0);
  });
});
