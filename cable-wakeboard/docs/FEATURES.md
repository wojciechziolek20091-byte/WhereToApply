# Wake park features

The features spec ("Wake Park Features: Models, Ride Data, Layout"), as built.
This file grows with each milestone.

## Audit: what was already in the game (spec section 13)

- **Rider and detection code.** Riding is the deterministic 60 Hz sim
  (`src/sim`, Luau twin `roblox/src/shared/Sim`), not Roblox physics.
  - Features were data: `KickerDef` (power-curve ramp: length, width, height,
    lip angle) and `SliderDef` (box / rail / tube with a straight entry ramp,
    `flush` or `gap` safety).
  - `features.ts` answered "surface under this point". `onFeature.ts` rode
    it, with modes `onKicker`, `onSafety` and `onFeature`.
  - Entries: `rideOn`, `popOn`, `pop` and `ollieOn`.
  - Crash reasons: `hitFeature`, `shortOllie`, `missedSafetyPop` and
    `fellOffFeature`.
  - Slides: `fiftyFifty`, `switchFiftyFifty`, `backboard` and `frontboard`.
- **The Roblox client only drew features** (WedgeParts and blocks). No code
  read tags, attributes or child names, so there were no Roblox names to
  keep. The spec's `Kicker` / `Obstacle` tags are added as the category tags,
  next to `ParkFeature`.
- **Water:** a flat plane at y = 0.
- **Cable:** a 5-tower counter-clockwise loop, 586 m, 9 m high, rope 18 m,
  8.3 m/s. The straights are 88, 143, 53, 64 and 162 m. A 2-tower shuttle mode
  exists for testing.
- **Art style:** low-poly faceted parts, flat colours, white HDPE tops with
  blue sides. 0.28 m per stud (= the spec's 3.57 studs per metre).

## Conflicts and decisions

| Spec | Here | Why |
|---|---|---|
| The board rides `Ride/` parts | The sim rides `FeatureShapes` pieces; `Ride/` parts are built from the same pieces | Roblox collision would split the server, the web game and the parity tests apart |
| `L x W x H` | Safety and kicker lengths are measured from the waterline; the 0.25 m underwater run is added before, on the same slope | The funbox's 3 m entry to 1.0 m is then 18.4 deg (inside 12-22); measured from the underwater start it would be 22.6 |
| Rooftop rail height 0.4-1.4 m | Checked at the peak (1.2 m) | "Up 4 m at +15 deg to a flat at 1.2 m" starts at 0.16 m |
| PopZoneLength 0.5 m | 1.0 m, the sim's pop window (`safety.popWindowMinMetres`) | The attribute shows the window the sim really uses |
| Max ollie height "1.3 m if none" | 2.15 m, from the sim's `ollie.maxV` | The game has one |
| Create a cable if none | The existing loop is kept; the spec's lines go on its straights | It exists |

## FeatureConfig (milestone 1)

- **`src/sim/featureCatalog.ts`:** the 15 features' default parameters and
  metadata: type, difficulty, material, allowed slides, bidirectional,
  category tag, map icon. Shared numbers: underwater depth 0.25 m, friction
  by material, score multipliers 1.0 / 1.2 / 1.4 / 1.6.
- **`src/park/featureConfig.ts`:** StudsPerMetre 3.57, collision groups,
  tags, folder names, colours, accents, materials, difficulty colours,
  validator thresholds, approach, bobbing and sounds.
- Both are generated to Luau by `npx vite-node scripts/gen-luau-data.ts`:
  - `Sim/FeatureCatalog.luau`;
  - `Park/FeatureConfig.luau` (`--!strict`), which includes the catalogue as
    `Catalog` and `Common`.

## Ride pieces (`featureShapes.ts`, `Sim/FeatureShapes.luau`)

A feature is a list of pieces in its own frame: u along the axis, v to its
right, h above the water. Each piece has:

| Field | Meaning |
|---|---|
| `role` | Safety, Main, ExitRamp, Ramp, Lip, Transition, Wall, LandingRamp |
| `index` | SegmentIndex |
| `part` | which rideable part (a main with its kinks); a new part means a gap or a transfer |
| `u0`, `u1`, `h0`, `h1` | ends; consecutive kinks share their joint exactly |
| `power` | kicker-style curve, flat at the water end; 0 = straight |
| `v0`, `v1` | centre line (splayed transfer box) |
| `width`, `profile`, `radius` | Flat or Round; pipe radius, coping or transition radius |
| `slide` | slideable |
| `lip` | riding off the high end launches |
| `cap` | pyramid side faces |
| `wall` | wall ride cross-section: a circular transition into a straight wall |

The old `kicker` / `slider` defs convert to pieces with bit-identical heights
and slopes (`tests/featureShapes.test.ts`).

## Model structure (`Park/FeatureModel.luau`)

- `Park/Features/<FeatureId>`: a Model with PrimaryPart `Root` and
  ModelStreamingMode Atomic.
- **Root:** invisible and anchored. Its LookVector is +u and its RightVector
  is +v.
- **Folders:** Visual, Ride, Crash, Approach, Signage, FX. Each has its own
  collision group and CanCollide / CanQuery / CanTouch settings.
- **Collision groups:** `FeatureRide`, `FeatureVisual`, `FeatureCrash` and
  `Rider`. The rider collides only with FeatureRide.
- **Attributes:** FeatureId, FeatureType, Difficulty, SafetyMode, LipHeight
  (studs), LipAngle, SurfaceMaterial, Friction, ScoreMultiplier,
  AllowedSlides, Bidirectional, plus FeatureName, CatalogName and Heading.
- **Tags:** `ParkFeature` and `Kicker` / `Obstacle`.
- **Tests:** `tests/featureModel.test.ts` checks the Luau shapes against
  TypeScript exactly, and builds every catalogue feature's model under the
  Roblox mock.
