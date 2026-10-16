/**
 * Layout spec section 1: the wake park and beginner line pass LayoutValidator;
 * placeFeatures follows the cable (move the towers and the features move with
 * them); the Luau PlaceFeatures and LayoutValidator agree with TypeScript;
 * and after a build every feature's ride data is intact.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatLayoutTable, validateLayout } from '../src/park/layoutValidator';
import { buildCablePath } from '../src/sim/cable';
import { DEFAULT_CONFIG } from '../src/sim/config';
import { resolvePark } from '../src/sim/park';
import { BEGINNER_LINE, BEGINNER_PARK, placeFeatures, travelCable, WAKE_CABLE, WAKE_LAYOUT, WAKE_PARK } from '../src/sim/parkLayout';
import { bundleShared } from './parity/luauBundle';
import { createRun, stepRun } from '../src/sim/session';
import { neutralInput } from '../src/sim/input';

const LUAU = process.env.LUAU;
const wake = { ...DEFAULT_CONFIG.cable, ...WAKE_CABLE };

describe('layout (real-park rules)', () => {
  it('the wake park passes every LayoutValidator rule', () => {
    const rows = validateLayout(WAKE_PARK, WAKE_LAYOUT);
    const failed = rows.filter((r) => !r.pass);
    expect(failed, formatLayoutTable(failed.length ? failed : rows.slice(0, 1))).toEqual([]);
    // 14 features x 14 rules (the last on a straight has no spacing / sides rows), plus the direction.
    expect(new Set(rows.map((r) => r.feature)).size).toBe(15);
  });

  it('the beginner line passes too', () => {
    expect(validateLayout(BEGINNER_PARK, BEGINNER_LINE, undefined, true).filter((r) => !r.pass)).toEqual([]);
  });

  it('the target layout: straights, order and sides', () => {
    const by = (n: number) => WAKE_LAYOUT.filter((e) => e.straight === n).map((e) => `${e.type}:${e.side}`);
    expect(by(1)).toEqual(['Slider:L', 'Funbox:R', 'MediumKicker:L']);
    expect(by(2)).toEqual(['PipeRail:R', 'GapBox:L', 'KinkRail:R']);
    expect(by(3)).toEqual(['ProKicker:L', 'Rooftop:R', 'Transfer:L']);
    expect(by(4)).toEqual(['StepUp:R', 'Pyramid:L', 'Spine:R']);
    expect(by(5)).toEqual(['FlatRail:L', 'WallRide:R']);
    expect(WAKE_PARK.features.map((f) => f.id)).toEqual(WAKE_LAYOUT.map((e) => e.featureId));
  });

  it('placeFeatures follows the cable: move every tower 6 m east and the features move with it', () => {
    const moved = { ...wake, towers: wake.towers.map((t) => ({ x: t.x + 6, z: t.z })) };
    const a = resolvePark({ name: 'a', features: placeFeatures(WAKE_LAYOUT, wake) }, buildCablePath(wake));
    const b = resolvePark({ name: 'b', features: placeFeatures(WAKE_LAYOUT, moved) }, buildCablePath(moved));
    a.forEach((f, i) => {
      expect(b[i]!.origin.x - f.origin.x).toBeCloseTo(6, 6);
      expect(b[i]!.origin.z - f.origin.z).toBeCloseTo(0, 6);
    });
  });

  it('a full run with no input meets no feature on either park (corners, the start, the shuttle return swing)', { timeout: 60000 }, () => {
    for (const park of [WAKE_PARK, BEGINNER_PARK]) {
      const run = createRun(DEFAULT_CONFIG, park);
      for (let i = 0; i < 60 * 300 && !run.finished; i++) stepRun(run, neutralInput());
      expect(run.crashes, park.name).toEqual([]);
      expect(run.endReason).toBe('passes');
    }
  });

  it('a clockwise park reverses the towers after the first and keeps sides relative to travel', () => {
    const cw = travelCable(wake, 'Clockwise');
    expect(cw.towers[0]).toEqual(wake.towers[0]);
    expect(cw.towers.slice(1)).toEqual([...wake.towers.slice(1)].reverse());
  });
});

describe.skipIf(!LUAU)('layout in Luau', () => {
  const run = (spec: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'layout-'));
    const file = join(dir, 'l.luau');
    writeFileSync(file, [readFileSync(join(__dirname, '../roblox/tests/mock_roblox.luau'), 'utf8'), bundleShared([], ['Sim', 'Park']), spec].join('\n'));
    return execFileSync(LUAU!, [file], { encoding: 'utf8', maxBuffer: 1 << 26 });
  };

  it('PlaceFeatures.place matches placeFeatures exactly', () => {
    const out = run(`
local PF = require(__root.Park.PlaceFeatures)
local Layout = require(__root.Park.Layout)
local Sim = require(__root.Sim)
for _, d in PF.place(Layout.MAIN, PF.cableOf(Sim.ParkLayout.WAKE_PARK)) do print(d.id, string.format("%.17g %.17g %.17g", d.s, d.offset, d.yaw)) end
for _, d in PF.place(Layout.BEGINNER, PF.cableOf(Sim.ParkLayout.BEGINNER_PARK)) do print(d.id, string.format("%.17g %.17g %.17g", d.s, d.offset, d.yaw)) end`);
    const ts = [...WAKE_PARK.features, ...BEGINNER_PARK.features].map((d) => `${d.id}\t${[d.s, d.offset, d.kind === 'feature' ? d.yaw ?? 0 : 0].map((v) => Number(v.toPrecision(17))).join(' ')}`);
    const lu = out.trimEnd().split('\n').map((l) => { const [id, nums] = l.split('\t'); return `${id}\t${nums!.split(' ').map((v) => Number(v)).join(' ')}`; });
    expect(lu).toEqual(ts);
  });

  it('LayoutValidator.luau gives the same table, and ride data is intact after buildPark', () => {
    const out = run(`
local LV = require(__root.Park.LayoutValidator)
local Layout = require(__root.Park.Layout)
local ParkBuilder = require(__root.Park.ParkBuilder)
local FeatureModel = require(__root.Park.FeatureModel)
local Sim = require(__root.Sim)
for _, pair in { { Sim.ParkLayout.WAKE_PARK, Layout.MAIN, false }, { Sim.ParkLayout.BEGINNER_PARK, Layout.BEGINNER, true } } do
  for _, r in LV.validate(pair[1], pair[2], nil, pair[3]) do print("ROW", r.feature, r.rule, tostring(r.pass), r.value, r.limit) end
  ParkBuilder.buildPark(pair[1], true)
  for _, r in LV.rideData(pair[1], pair[2], FeatureModel.featuresFolder()) do print("RIDE", r.feature, tostring(r.pass), r.value) end
end`);
    const lines = out.trimEnd().split('\n');
    const rows = lines.filter((l) => l.startsWith('ROW\t')).map((l) => l.slice(4));
    const ts = [...validateLayout(WAKE_PARK, WAKE_LAYOUT), ...validateLayout(BEGINNER_PARK, BEGINNER_LINE, undefined, true)].map((r) => [r.feature, r.rule, String(r.pass), r.value, r.limit].join('\t'));
    expect(rows).toEqual(ts);
    const ride = lines.filter((l) => l.startsWith('RIDE\t'));
    expect(ride).toHaveLength(WAKE_LAYOUT.length + BEGINNER_LINE.length);
    for (const l of ride) expect(l).toMatch(/\ttrue\tintact$/);
  });
});
