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

## Riding the pieces (sim, milestones 2-5)

`onFeature.ts` / `OnFeature.luau` ride any shape by its pieces' roles. The
old kicker and slider defs go through the same code with bit-identical
numbers (the existing parks' parity traces did not change).

| Situation | What happens |
|---|---|
| Water reaches an entry piece whose height is 0 or more (the underwater part is ridden over) | `onSafety` (Safety) or `onKicker` (Ramp, Transition...) |
| Safety, pop in the window, main flush | mount the main (`popOn` / `pop`), as before |
| Safety, pop in the window, water gap (gap box) | a real hop: ollie speed x `safety.gapPopScale` (0.25); landing on the main is the `popOn` / `pop` entry |
| Gap safety, no pop | `missedSafetyPop` |
| Up a piece with `lip` | take off at its end (a kicker, or the pyramid's and spine's ramps) |
| Mains with kinks | slide on: gravity along the slope, friction from the feature's material |
| Exit ramp, or a down rail into the water | ride out into the water (`rodeOut`) |
| Off the end of a high main (rooftop, step-up low rail) | roll off into the air; a higher main after a gap is a `shortOllie` unless popped onto |
| Splayed boxes (transfer) | slide along the piece's own heading |
| Over the pyramid's top onto its far face | roll down it |
| Landing on a landing ramp (spine, pyramid back) | an ordinary landing, then ride down and out |
| Wall ride | its own step: climb the transition and the wall with the speed cut in with, against gravity and friction, with the rope's pull. Ends by riding back down into the water, running off the end into the air, popping off (`feature.wallPopOut`), or going over the top (`fellOffFeature`). Scores as the new `Wall Ride` slide (150 points/s). |

Air-time probe (`npx vite-node scripts/probe-catalog.ts <name> [popAt]`), at
cable speed, no steering. The ride test (milestone 7) measures this properly.

| Kicker | Plain | With the ideal lip pop | Spec |
|---|---|---|---|
| Beginner | 0.75 s | 0.82 s | 0.6-0.9 |
| Medium | 1.02 s | 1.13 s | 1.0-1.4 |
| Pro | 1.28 s | 1.40 s | 1.4-2.0 |

### Changes from the spec's numbers, and why

- **Spine:**
  - **Spec:** 2 x 5 m, peak 1.4 m.
  - **Here:** a 5 m launch ramp (15 deg lip), then a straight 12 m landing slope.
  - **Why:** at cable speed a rider flies 8-9 m off a 1.4 m peak. A 5 m
    landing ramp, or a curved one, drops away under the flight, and every
    try landed in the flat water.
- **Wall ride:**
  - **Spec:** sizes as given; the angle into the line isn't specified.
  - **Here:** the sizes are kept, and the wall is turned about 34 deg
    (`yaw -0.6`) into the riders' line.
  - **Why:** the face is only 4 m long. Parallel to the line, riders are on it
    for 0.25 s and climb 0.3 m. Turned in, the pull carries them up about
    1.1 m for 0.5 s.
- **Gap box:**
  - **Spec:** pop across the gap.
  - **Here:** the pop across the gap is a small hop.
  - **Why:** a full ollie over a 1.2 m gap overshoots the 6 m box.

## FeatureBuilder (milestones 2-5)

`roblox/src/shared/Park/FeatureBuilder.luau` builds a model from a
catalogue name and a parameter table:
- **Ride/ parts:** one per straight piece. Curves are split into
  `KickerSubsegments` (10) chords, the last of which is the `Lip`, carrying
  `LipPoint`. The wall transition is split into 6. Each Ride part has Start
  and End attachments and the attributes SurfaceRole, SegmentIndex,
  PieceIndex, Part, Width, Profile, Radius and Slide. A safety's last Ride
  part has `PopZoneStart` and `PopZoneLength`.
- **Art:** HDPE top sheets whose top face is the ride surface, coping, side
  panels in the line's accent colour, a steel frame with legs and braces,
  pontoons, a difficulty stripe on the leading edge, and a sign. Kickers get
  curved skirts and a back wall.
  - **Wall ride:** a Skatelite face, a steel frame, a top coping bar, and end
    panels following the curve.
  - **Pyramid:** each face is a centre strip plus right-triangle wedges, so
    the faces meet at the hips.
- **Tests:** `tests/featureModel.test.ts` builds every catalogue feature
  (both sides) under the mock. It checks that every Ride part's Start and End
  lie on the sim's surface within 1 cm, and that each model is under 120
  parts.
- **Web game:** the web game draws the same parts.
  `scripts/export-feature-art.ts` builds them in Luau into
  `src/art/featureParts.json`, and a test fails if that file is stale. So
  the web captures show the Roblox models.
- **Previews:** `?park=catalog` opens a map with every catalogue feature on
  the line. `renderer.featureCam = { id, angle }` aims a camera at one
  feature (approach / side / rear / top / low) for captures.

## FeatureRegistry, crash volumes, approach data (milestone 6)

- **`Park/FeatureRegistry.luau`** works on the client and the server. It
  indexes every `ParkFeature` model, keeping up with streaming and rebuilds
  through the tag signals. It offers:
  - `getSurfaceAt(position, down)`: projects onto each Ride part's Start to
    End segment, with no raycasts. It returns the role, segment, progress
    (0-1), normal, tangent, distance to centre, profile, the point and its
    distance. On round pipes the normal points from the axis to the contact.
  - `getNearby(position, radius)`, `getCrashAt(position)`, `byId(id)`,
    `all()` and `refresh(model)`.
  - **Test** (`feature_registry_spec.luau`):
    - On every piece of every feature, `getSurfaceAt` finds the sim's role,
      and the sim's height within 2 cm (219/219 samples).
    - Gaps have no surface.
    - Under a box top is a `shortOllie` volume; the gap is
      `missedSafetyPop`; over the wall's top edge is `fellOffFeature`.
  - It is wired into the client. The rider's physics stays the sim's: the
    registry answers the same question from the parts, for tools, tutorials,
    AI riders, effects and the crash UI.
- **Crash volumes (`Crash/`):** each has a `CrashReason` attribute (the
  sim's own reason) and a `CrashMessage` (from `FeatureConfig.CrashMessages`,
  shown in the client's crash text), and is tagged `FeatureCrashVolume`.
  - Under every slide top, from 6 cm below it to the water: `shortOllie`.
  - The water gap between parts: `missedSafetyPop` after a safety,
    `shortOllie` between step-up rails.
  - The sides of tall safeties: `hitFeature`.
  - A wall ride's top edge: `fellOffFeature`.
- **Approach data (`Approach/`):**
  - An `Entry` attachment 12 m before the feature, along the cable's
    direction (so a turned wall ride's approach comes in at its angle).
  - Attributes `IdealSpeed` (cable speed, 8.3 m/s), `Side` and `SideGoofy`
    (Toeside / Heelside / Either, from the offset to the cable),
    `EntryDistance`, and `IdealPopOffset` on kickers (the middle of the
    sim's lip-pop window, 0.06 s).
