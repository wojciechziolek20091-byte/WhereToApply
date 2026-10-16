/**
 * Writes the Luau copies of the sim's data from the TypeScript sources, so
 * the data has one source:
 *   roblox/src/shared/Sim/Config.luau      from src/sim/config.ts (DEFAULT_CONFIG)
 *   roblox/src/shared/Sim/ParkLayout.luau  from src/sim/parkLayout.ts
 *   roblox/src/shared/Anim/AnimConfig.luau from src/anim/config.ts (DEFAULT_ANIM_CONFIG)
 *   roblox/src/shared/Anim/RiderPoses.luau from src/anim/poses.ts (all clips)
 *   roblox/src/shared/Sim/FeatureCatalog.luau from src/sim/featureCatalog.ts
 *   roblox/src/shared/Park/FeatureConfig.luau from src/park/featureConfig.ts
 * Run after editing either:
 *   npx vite-node scripts/gen-luau-data.ts
 * tests/parity.test.ts fails if the two drift apart.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG, DT, GRAVITY } from '../src/sim/config';
import { BEGINNER_LAYOUT, BEGINNER_PARK, CATALOG_TEST_PARK, LAKESIDE_PARK, TEST_PARK, WAKE_PARK, WAKE_PARK_LAYOUT } from '../src/sim/parkLayout';
import { DEFAULT_ANIM_CONFIG } from '../src/anim/config';
import { ALL_CLIPS, CRASH_LEAD_IN } from '../src/anim/poses';
import { CATALOG_COMMON, FEATURE_CATALOG } from '../src/sim/featureCatalog';
import { FEATURE_CONFIG } from '../src/park/featureConfig';

import { lua } from './luaLiteral';

const out = `-- GENERATED from src/sim/parkLayout.ts by scripts/gen-luau-data.ts. Do not edit:
-- edit the TypeScript file and rerun the script. The lakeside cable park from
-- the user's map: features along the cable, plus the site (shore, island,
-- dock, buildings) for renderers. Towers are in Config.luau.
local ParkLayout = {}

ParkLayout.LAKESIDE_PARK = ${lua(LAKESIDE_PARK, '')}

-- Test map (spec section 16): features on the cable line; same site as the default park.
ParkLayout.TEST_PARK = ${lua({ ...TEST_PARK, site: undefined }, '')}
ParkLayout.TEST_PARK.site = ParkLayout.LAKESIDE_PARK.site

-- Every catalogue feature on the cable line (tests, parity).
ParkLayout.CATALOG_TEST_PARK = ${lua({ ...CATALOG_TEST_PARK, site: undefined }, '')}
ParkLayout.CATALOG_TEST_PARK.site = ParkLayout.LAKESIDE_PARK.site

-- The wake park (the default): the features spec's lines on the loop. Its
-- site adds marker buoys and the cable operator hut to the lakeside site.
ParkLayout.WAKE_PARK = ${lua(WAKE_PARK, '')}

-- The beginner 2-tower system, its own map with its own cable.
ParkLayout.BEGINNER_PARK = ${lua({ ...BEGINNER_PARK, site: undefined }, '')}
ParkLayout.BEGINNER_PARK.site = table.clone(ParkLayout.WAKE_PARK.site)
ParkLayout.BEGINNER_PARK.site.docks = ${lua(BEGINNER_PARK.site!.docks, '')}
ParkLayout.BEGINNER_PARK.site.buoys = ${lua(BEGINNER_PARK.site!.buoys, '')}

return ParkLayout
`;
writeFileSync(join(__dirname, '../roblox/src/shared/Sim/ParkLayout.luau'), out);

const layout = `--!strict
-- GENERATED from src/sim/parkLayout.ts by scripts/gen-luau-data.ts. Do not edit:
-- edit the TypeScript file and rerun the script.
-- Park/Layout (features spec section 9): every feature of the wake park and
-- the beginner 2-tower system, in the spec's terms: catalogue type, params,
-- segmentOfCable (1-based straight in order of travel), distanceAlong (m),
-- sideOffset (m, + right of the cable line), facing ("WithCable",
-- "AgainstCable" or an angle in radians). The sim's park defs
-- (Sim.ParkLayout.WAKE_PARK / BEGINNER_PARK) are made from these.
-- ParkBuilder.buildPark() builds them into Workspace.Park.Features.
local Layout = {}

Layout.MAIN = ${lua(WAKE_PARK_LAYOUT, '')}

Layout.BEGINNER = ${lua(BEGINNER_LAYOUT, '')}

return Layout
`;
writeFileSync(join(__dirname, '../roblox/src/shared/Park/Layout.luau'), layout);

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
const catalog = `-- GENERATED from src/sim/featureCatalog.ts by scripts/gen-luau-data.ts. Do not edit:
-- edit the TypeScript file (it documents every entry) and rerun the script.
-- The 15 wake park features: default dimensions (metres, degrees) and
-- gameplay metadata. FeatureShapes.luau turns an entry into ride pieces.
local FeatureCatalog = {}

FeatureCatalog.CATALOG_COMMON = ${lua(CATALOG_COMMON, '')}

FeatureCatalog.FEATURE_CATALOG = ${lua(FEATURE_CATALOG, '')}

return FeatureCatalog
`;
writeFileSync(join(__dirname, '../roblox/src/shared/Sim/FeatureCatalog.luau'), catalog);

const { Common: _c, Catalog: _k, ...featureConfig } = FEATURE_CONFIG;
const featureConfigLuau = `--!strict
-- GENERATED from src/park/featureConfig.ts by scripts/gen-luau-data.ts. Do not edit:
-- edit the TypeScript file (it documents every entry) and rerun the script.
-- FeatureConfig: units, collision groups, tags, colours, materials, validator
-- thresholds, approach, bobbing and sounds for the wake park features. The
-- ride dimensions are the sim's catalogue, included as Catalog / Common.
local FeatureCatalog = require(script.Parent.Parent.Sim.FeatureCatalog)

local FeatureConfig = ${lua(featureConfig, '')}

FeatureConfig.Common = FeatureCatalog.CATALOG_COMMON
FeatureConfig.Catalog = FeatureCatalog.FEATURE_CATALOG

-- Metres to studs.
function FeatureConfig.studs(m: number): number
\treturn m * FeatureConfig.StudsPerMetre
end

-- Difficulty colour (1-4).
function FeatureConfig.difficultyColor(d: number): Color3
\tlocal c = FeatureConfig.Difficulty[d].color
\treturn Color3.fromRGB(c[1], c[2], c[3])
end

-- A named colour from Colors or Accents.
function FeatureConfig.color(name: string): Color3
\tlocal c = (FeatureConfig.Colors :: any)[name] or (FeatureConfig.Accents :: any)[name]
\tassert(c, "unknown colour " .. name)
\treturn Color3.fromRGB(c[1], c[2], c[3])
end

export type FeatureConfig = typeof(FeatureConfig)

return FeatureConfig
`;
mkdirSync(join(__dirname, '../roblox/src/shared/Park'), { recursive: true });
writeFileSync(join(__dirname, '../roblox/src/shared/Park/FeatureConfig.luau'), featureConfigLuau);
console.log('wrote ParkLayout.luau, Config.luau, AnimConfig.luau, RiderPoses.luau, FeatureCatalog.luau and FeatureConfig.luau');
