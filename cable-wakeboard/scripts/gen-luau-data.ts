/**
 * Writes the Luau copies of the sim's data from the TypeScript sources, so
 * the data has one source:
 *   roblox/src/shared/Sim/Config.luau      from src/sim/config.ts (DEFAULT_CONFIG)
 *   roblox/src/shared/Sim/ParkLayout.luau  from src/sim/parkLayout.ts
 *   roblox/src/shared/Anim/AnimConfig.luau from src/anim/config.ts (DEFAULT_ANIM_CONFIG)
 *   roblox/src/shared/Anim/RiderPoses.luau from src/anim/poses.ts (all clips)
 * Run after editing either:
 *   npx vite-node scripts/gen-luau-data.ts
 * tests/parity.test.ts fails if the two drift apart.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG, DT, GRAVITY } from '../src/sim/config';
import { LAKESIDE_PARK, TEST_PARK } from '../src/sim/parkLayout';
import { DEFAULT_ANIM_CONFIG } from '../src/anim/config';
import { ALL_CLIPS, CRASH_LEAD_IN } from '../src/anim/poses';

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const LUAU_KEYWORDS = new Set(['local', 'end', 'function', 'then', 'repeat', 'until', 'nil', 'not', 'and', 'or']);

function lua(v: unknown, indent: string): string {
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return String(v);
  const inner = `${indent}\t`;
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x !== 'object')) return `{ ${v.map((x) => lua(x, inner)).join(', ')} }`;
    // Short rows (points) stay on one line.
    const rows = v.map((x) => lua(x, inner));
    const oneLine = `{ ${rows.join(', ')} }`;
    if (!oneLine.includes('\n') && oneLine.length < 160) return oneLine;
    return `{\n${rows.map((r) => `${inner}${r},`).join('\n')}\n${indent}}`;
  }
  const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
  const parts = entries.map(([k, x]) => `${IDENT.test(k) && !LUAU_KEYWORDS.has(k) ? k : `[${JSON.stringify(k)}]`} = ${lua(x, inner)}`);
  const flat = `{ ${parts.join(', ')} }`;
  if (!flat.includes('\n') && flat.length < 160) return flat;
  return `{\n${parts.map((p) => `${inner}${p},`).join('\n')}\n${indent}}`;
}

const out = `-- GENERATED from src/sim/parkLayout.ts by scripts/gen-luau-data.ts. Do not edit:
-- edit the TypeScript file and rerun the script. The lakeside cable park from
-- the user's map: features along the cable, plus the site (shore, island,
-- dock, buildings) for renderers. Towers are in Config.luau.
local ParkLayout = {}

ParkLayout.LAKESIDE_PARK = ${lua(LAKESIDE_PARK, '')}

-- Test map (spec section 16): features on the cable line; same site as the default park.
ParkLayout.TEST_PARK = ${lua({ ...TEST_PARK, site: undefined }, '')}
ParkLayout.TEST_PARK.site = ParkLayout.LAKESIDE_PARK.site

return ParkLayout
`;
writeFileSync(join(__dirname, '../roblox/src/shared/Sim/ParkLayout.luau'), out);

const config = `-- GENERATED from src/sim/config.ts by scripts/gen-luau-data.ts. Do not edit:
-- edit the TypeScript file (it documents every entry) and rerun the script.
-- Every tunable in the sim, SI units, angles in radians.
local Config = {}

Config.DT = 1 / 60
Config.GRAVITY = ${GRAVITY}

Config.DEFAULT_CONFIG = ${lua(DEFAULT_CONFIG, '')}

local function deepCopy(t)
\tif type(t) ~= "table" then
\t\treturn t
\tend
\tlocal out = {}
\tfor k, v in t do
\t\tout[k] = deepCopy(v)
\tend
\treturn out
end

-- Copy of the defaults with per-section overrides, e.g. { run = { maxFalls = 3 } }.
function Config.makeConfig(overrides)
\tlocal out = deepCopy(Config.DEFAULT_CONFIG)
\tfor section, values in overrides or {} do
\t\tfor k, v in values do
\t\t\tout[section][k] = v
\t\tend
\tend
\treturn out
end

Config.deepCopy = deepCopy

return Config
`;
if (DT !== 1 / 60) throw new Error('Config.luau hard-codes DT = 1 / 60; update the generator');
writeFileSync(join(__dirname, '../roblox/src/shared/Sim/Config.luau'), config);

const animConfig = `-- GENERATED from src/anim/config.ts by scripts/gen-luau-data.ts. Do not edit:
-- edit the TypeScript file (it documents every entry) and rerun the script.
-- Every timing, angle and spring of the rider animation: degrees, metres,
-- seconds, springs as { freq = Hz, damping = ratio }.
local AnimConfig = {}

AnimConfig.DEFAULT = ${lua(DEFAULT_ANIM_CONFIG, '')}

return AnimConfig
`;
writeFileSync(join(__dirname, '../roblox/src/shared/Anim/AnimConfig.luau'), animConfig);

const poses = `-- GENERATED from src/anim/poses.ts by scripts/gen-luau-data.ts. Do not edit:
-- edit the TypeScript file (it explains the axes and every clip) and rerun.
-- RiderPoses: every base pose, trick clip, grab and crash lead-in as data,
-- for the canonical regular rider; mirrorPose makes goofy and switch.
local RiderPoses = {}

RiderPoses.ALL_CLIPS = ${lua(ALL_CLIPS, '')}

RiderPoses.CRASH_LEAD_IN = ${lua(CRASH_LEAD_IN, '')}

return RiderPoses
`;
writeFileSync(join(__dirname, '../roblox/src/shared/Anim/RiderPoses.luau'), poses);
console.log('wrote ParkLayout.luau, Config.luau, AnimConfig.luau and RiderPoses.luau');
