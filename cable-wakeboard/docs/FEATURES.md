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

## FeatureValidator and FeatureRideTest (milestone 7)

**`Park/FeatureValidator.luau`** checks a built model against section 5 and
returns a report (`FeatureValidator.print` prints it):

| Rule | What it measures |
|---|---|
| Safety slope | 12-22 deg, from the first Safety Ride part's Start and End |
| Safety starts under water | 0.15-0.35 m under, at the Start attachment |
| Kicker transition | at least 6 sub-segments |
| Kicker lip angle | within 0.5 deg of the spec (`LipPoint` faces the curve's tangent) |
| Kicker lip height | within 2 cm of the spec |
| Kicker width | at least 2.5 m |
| Box top width | at least 0.8 m (slider 1.0 m) |
| Rail height | 0.4-1.4 m, and under the sim's ollie height |
| Top reachable by ollie | boxes may be low (the slider is 0.3 m): only a maximum |
| Kink joints | meet within 1 cm |
| Kink angle | at most 20 deg (the funbox's flat-to-exit change counts: 18.4 deg) |
| Visual matches ride surface | top sheets within 2 cm of every Ride part (they sit exactly on it: 0.0 mm) |
| Edges have coping | coping radius at least 3 cm |
| Part count | at most 120 |
| Placement (given the cable and the other footprints) | within the rope's 18 m of the cable line, at least 2 m off it, and clear by 8 m along the approach and 12 m after the exit |

- All 15 catalogue features pass.
- A test also breaks parameters and checks that the right rule fails: a 30
  deg safety, a 2 m kicker, a 1.8 m rail, a 25 deg kink, a 0.9 m slider.

**`Park/FeatureRideTest.luau`** rides every feature with the Luau sim, the
game's own rider (the same code as the server, identical to the web game).
For each feature it:
- lines up on the approach, aiming for the right line against the rope's
  pull;
- runs the section 10 tests;
- checks every tick on the feature that `FeatureRegistry.getSurfaceAt`
  finds the role the sim is riding.

The ollie-on, step-up and transfer tests are seeded random searches (at most
600 tries) over the line, the cut and the pop. The balance meter is off
(that's the player's job). `tests/featureModel.test.ts` fails on any FAIL.

Results on the catalogue test map:

| Feature | Test | Result | Numbers |
|---|---|---|---|
| BeginnerKicker | Launch (ideal pop) | PASS | lip 7.9 m/s at 21 deg, peak 0.99 m, air 0.82 s (plain 0.75), 6.9 m [want 0.6-0.9 s] |
| BeginnerKicker | Registry along the ramp | PASS | 18/18 ticks, 2.0 cm |
| Slider | Up the safety | PASS | rideOn, slid 0.97 s, clean exit |
| Slider | Registry along the feature | PASS | 65/65 ticks, 3.5 cm |
| Slider | Ollie on from the water | PASS | from v=2.5 m, pop -1.2 m along the main (33 tries) |
| Spine | Launch, land on the down slope | PASS | lip 7.9 m/s at 22 deg, peak 1.79 m, air 0.90 s (plain 0.82), 7.5 m, on the landing ramp |
| Spine | Registry along the ramp | PASS | 50/50 ticks, 1.3 cm |
| Funbox | Up the safety | PASS | rideOn, slid 1.03 s, clean exit |
| Funbox | Kink joints | PASS | largest speed change in a tick 0.16 m/s |
| Funbox | Registry along the feature | PASS | 87/87 ticks, 1.6 cm |
| Funbox | Ollie on from the water | PASS | from v=-1.9 m, pop -1.7 m along the main (42 tries) |
| MediumKicker | Launch (ideal pop) | PASS | lip 7.9 m/s at 29 deg, peak 1.94 m, air 1.12 s (plain 1.02), 9.7 m [want 1.0-1.4 s] |
| MediumKicker | Registry along the ramp | PASS | 30/30 ticks, 1.8 cm |
| PipeRail | Up the safety | PASS | rideOn, slid 1.20 s, clean exit |
| PipeRail | Registry along the feature | PASS | 87/87 ticks, 3.5 cm |
| PipeRail | Ollie on from the water | PASS | from v=2.0 m, pop -0.2 m along the main (15 tries) |
| GapBox | Up the safety, pop in the window | PASS | popOn, slid 0.18 s, clean exit |
| GapBox | Registry along the feature | PASS | 32/32 ticks, 3.0 cm |
| GapBox | Ollie on from the water | PASS | from v=-2.0 m, pop -1.9 m along the main (116 tries) |
| FlatRail | Up the safety | PASS | rideOn, slid 1.20 s, clean exit |
| FlatRail | Registry along the feature | PASS | 90/90 ticks, 3.5 cm |
| FlatRail | Ollie on from the water | PASS | from v=2.1 m, pop -1.2 m along the main (14 tries) |
| WallRide | Up the wall and out | PASS | wallRide 0.30 s, 0.83 m up |
| WallRide | Registry on the wall | PASS | 18/18 ticks, 4.3 cm |
| KinkRail | Up the safety | PASS | rideOn, slid 1.12 s, clean exit |
| KinkRail | Kink joints | PASS | largest speed change in a tick 0.12 m/s |
| KinkRail | Registry along the feature | PASS | 93/93 ticks, 3.5 cm |
| KinkRail | Ollie on from the water | PASS | from v=-2.0 m, pop 0.3 m along the main (50 tries) |
| Transfer | Up the safety | PASS | rideOn, slid 0.70 s, clean exit |
| Transfer | Registry along the feature | PASS | 58/58 ticks, 2.7 cm |
| Transfer | Transfer A to B | PASS | pop at u=3.3 m, charge 0.35 s (3 tries) |
| Transfer | Ollie on from the water | PASS | from v=2.8 m, pop -1.8 m along the main (59 tries) |
| Rooftop | Up the safety | PASS | rideOn, slid 1.17 s, clean exit |
| Rooftop | Kink joints | PASS | largest speed change in a tick 0.17 m/s |
| Rooftop | Registry along the feature | PASS | 74/74 ticks, 3.5 cm |
| Rooftop | Ollie on from the water | PASS | from v=-1.4 m, pop 0.0 m along the main (9 tries) |
| StepUp | Up the safety | PASS | rideOn, slid 0.47 s, shortOllie into the high rail (expected) |
| StepUp | Registry along the feature | PASS | 41/41 ticks, 3.5 cm |
| StepUp | Pop up to the second rail | PASS | pop at u=5.2 m, charge 0.13 s (1 tries) |
| StepUp | Ollie on from the water | PASS | from v=2.0 m, pop -0.2 m along the main (15 tries) |
| Pyramid | Launch and land | PASS | lip 8.2 m/s at 27 deg, peak 2.00 m, air 1.12 s (plain 1.02), 9.8 m |
| Pyramid | Registry along the ramp | PASS | 25/25 ticks, 3.4 cm |
| ProKicker | Launch (ideal pop) | PASS | lip 8.1 m/s at 37 deg, peak 3.17 m, air 1.40 s (plain 1.28), 12.3 m [want 1.4-2.0 s] |
| ProKicker | Registry along the ramp | PASS | 42/42 ticks, 1.1 cm |

### Fixes the ride test drove

- **Transfer box:**
  - **Problem:** a rider could not get from box A to box B. Sliding damps
    out sideways motion, and the rope only pulls about 0.4 m in the air.
  - **New:** `feature.sideHop` (2.8 m/s, catalogue features only). Tap A/D
    as the pop releases on a slide to hop sideways.
  - **Placement:** box B goes on the cable side of a feature 3 m or more off
    the cable, so the rope helps the hop.
- **Corners:** features right after a corner left the rider swinging, so the
  catalogue map now keeps 20 m or more of straight cable before every
  feature, as the spec asks.
- **`LipPoint`:** now faces the curve's tangent (the launch direction), not
  the last chord.
- **Registry:** a ray down the joint between two chords missed both, so a
  1e-4 tolerance on the segment ends was added.
- **Crash volumes under sloped mains:** these now hang the full height.

## Visual realism (milestone 8)

All in FeatureBuilder, inside the part budget (the largest feature, the
wall ride, is about 60 parts):

- **HDPE sheets:**
  - Black tops on boxes and rails, white on kickers.
  - Reflectance 0.07.
  - Where a sheet goes under the water it is split at the waterline, and the
    part under the water gets the algae tint.
- **Bolt heads** in a row under each coping, every 0.6 m, at most 12 per side.
- **Anchor chains** run from the four corners down into the water, ending in
  small buoys: orange at the front, white at the back.
- **Water details:**
  - A foam strip across the entry where it pierces the water, and along the
    sides (see-through, so it is Roblox only: the web mesh leaves it out).
  - A darker wet band along the sides at the waterline.
- **A wear strip** runs along the middle of every box top.
- **Fictional graphics** (`FeatureConfig.Decals`), four designs:
  - the `LAKESIDE WAKE / CABLE PARK` wordmark and the line tag (line name
    and difficulty), as SurfaceGuis on the two biggest side panels. Roblox
    only; no image assets needed;
  - chevrons by the entry (parts);
  - a dot row near the exit (parts).
- **Bobbing** (`Park/FeatureBob.luau`, client):
  - Only the Visual folder moves, +-3 cm at 0.2 Hz, each feature with its
    own phase.
  - It eases to rest within 6 m of a rider, so the art meets the ride
    surface at contact.
  - `feature_bob_spec.luau` checks the amplitude, that Ride/ never moves,
    and the freeze. The web game does not bob.
- **Shadows:** Visual parts cast shadows; Ride/Crash parts are invisible and
  cast none.

## Park layout (milestone 9)

- **Where the layout lives:** `src/sim/parkLayout.ts` holds the layout in
  the spec's terms. Each entry gives `type`, `params`, `segmentOfCable`
  (1-based straight in order of travel), `distanceAlong`, `sideOffset`
  (+ right of the cable line) and `facing` (`WithCable` / `AgainstCable` /
  an angle).
  - `placeLayout` turns entries into the sim's feature defs.
  - The generated `Park/Layout.luau` holds the same entries for Roblox.
- **The default park is the wake park (`WAKE_PARK`), on your loop and site.**
  - **The order of the lines is not the spec's.** The spec's clearance rule
    (8 m along the approach, 12 m after the exit) needs about 20 m between
    features, and the south straight (88 m) has the start dock on its
    outside. So the lines fit the straights' real lengths, in order of
    travel from the dock:

| Line | Features | Where | Accent |
|---|---|---|---|
| Line 1 | medium kicker, pipe rail, funbox | east straight, outside | orange |
| Line 4 | pyramid, wall ride (turned 34 deg into the line), spine | the roof: north-east, north-west | magenta |
| Line 2 | gap box, flat-down rail, transfer box (B toward the cable) | west straight, outside | teal |
| Line 3 | pro kicker, rooftop, step-up rail | the end of the west straight, then the south straight before the dock | yellow |

- **Beginner 2-tower system (`BEGINNER_PARK`, `?park=beginner`):**
  - One 150 m straight inside the loop, between the island and the east
    straight, 20 m from both.
  - Its features: a slider, the beginner kicker, and a lower funbox (0.6 m).
  - The carrier shuttles out and back, and the features face the outbound
    run.
  - It is its own map: the sim runs one cable at a time.
  - `ParkDef.cable` lets a park bring its own cable (TS and Luau).
- **Your sketch layout is kept:** `LAKESIDE_PARK`, `?park=sketch` (web) or
  the Workspace attribute `WakePark = "sketch"` (Roblox).
- **Site extras:**
  - Marker buoys at both ends of every straight with features, on the far
    side of the cable from them (out of their approach and landing zones).
  - A cable operator hut by the start dock.
  - The beginner map has its own dock and buoys.
  - Trees and shore are the existing site.
- **`Park/ParkBuilder.luau`:** `buildPark(park)`:
  - clears `Workspace.Park.Features`;
  - builds every catalogue feature at the sim's placement;
  - validates each one against all of section 5, including cable reach and
    clearance from the other features, the docks and the buoys;
  - places only those that pass, warning with the failed rules for the rest;
  - re-indexes the registry.
  - It is idempotent (`park_build_spec.luau`). The client calls it, and
    `WakePark = "wake" | "beginner" | "sketch"` picks the park.
- **Results:** all 12 wake park features and all 3 beginner features pass the
  validator with placement. The ride test passes on the catalogue map, the
  wake park and the beginner line.
- **Tuning on the way:** `kicker.lipPopBonus` went from 0.2 to 0.3. The pro
  kicker at its east-straight spot reached only 1.38-1.40 s with the ideal
  pop (the spec wants 1.4-2.0). Now beginner / medium / pro are 0.85 / 1.18 /
  1.47 s.
- **Feature IDs** follow the spec: `L1_MediumKicker_01`, `B_Slider_01`...

## FX, audio, map, approach tags, stats, challenges, preview (milestone 10)

All of these live in `roblox/src/shared/Park/`.

| Module | What it does |
|---|---|
| `FeatureBuilder` (FX/) | Adds FX attachments with an `FxKind` attribute: `SplashEntry` (where the entry meets the water), `SplashExit`, `Slide1..n` along the slide surfaces (`Droplets` on HDPE, `Sparks` on steel pipes, `LipSpray` on kicker lips) and a `WallSlap` on the wall ride. |
| `FeatureFX` | Puts a ParticleEmitter and a Sound on each FX attachment. Sound ids come from `FeatureConfig.Sounds`, keyed by SurfaceMaterial; they are empty, so effects stay silent until assets exist. `onEvents(sim, events)` turns the sim's events into effects: a splash on `featureEnter`, slide particles from mount to exit, a splash on `featureExit`, and an impact plus `onShake` on a crash. |
| `FeatureMap` | `entries()` / `byLine()` give each feature's icon, difficulty, line and position. `mount()` draws a simple top-down map with a list by line; it toggles on M in the client. |
| `FeatureTags` | A name + difficulty BillboardGui over each sign. It shows when the rider is within 25 m before the feature, and `FeatureTags.enabled` is the settings toggle. |
| `FeatureStats` | Hits, clean landings and the best trick (name and score) per player and FeatureId, recorded from sim events and trick records. `onRecord` is the leaderboard hook. |
| `FeatureChallenges` | 13 challenges as data, for example "Backside boardslide the full pipe rail", "Pop-on the gap box", "Air over 1.5 s off the pro kicker", "Ride the wall for 0.4 s". `check(challenge, event)` and `completed(events)` test them against the sim's `slideDone` / `landed` events. The client shows "Challenge: ...!" when one is done. |
| `FeatureBuilder.preview(type, params)` | A command-bar tool: it drops the feature 20 m in front of the camera into `Workspace.Park.Preview` (replacing the last one) and prints its validator report. |

`feature_extras_spec.luau` checks all of this under the mock:
- It builds the wake park and rides three features with the Luau sim.
- The name tags show on the approach, and splashes fire.
- The hit and the clean landing are counted.
- The medium-kicker-air and gap-box pop-on challenges complete; a 50-50
  does not count as a backboard.
- The preview replaces its last feature.

## Final report (milestone 11)

Every feature placed in the wake park and on the beginner line:
- **Validator:** all section 5 rules, with placement (cable reach and
  clearance).
- **Parts:** the model's BasePart count.
- **Ride test:** Luau sim; "registry" is the ticks where
  `FeatureRegistry.getSurfaceAt` found the role the sim was riding.

`tests/featureModel.test.ts` reproduces it. All 15 pass.

| Feature | Line | Difficulty | Dimensions | Placement | Validator | Parts | Ride test |
|---|---|---|---|---|---|---|---|
| L1_MediumKicker_01 (Medium kicker) | Line 1 | 2 blue | 7 x 3 m, lip 1.2 m at 25 deg | s 125, +4 m | PASS (9 rules) | 65 | PASS: Launch (ideal pop): lip 7.9 m/s at 31 deg, peak 2.02 m, air 1.15 s (plain 1.02), 9.8 m [want 1.0-1.4 s]; registry 31/31 ticks |
| L1_PipeRail_01 (Pipe rail) | Line 1 | 2 blue | 10 m from 0.60 m; pipe 0.25 m | s 155, +3 m | PASS (10 rules) | 57 | PASS: Up the safety: rideOn, slid 1.18 s, clean exit; Ollie on from the water: from v=-1.3 m, pop 0.9 m along the main (151 tries); registry 87/87 ticks |
| L1_Funbox_01 (Funbox) | Line 1 | 2 blue | 6 m from 1.00 m; 1.5 m wide; exit 3 m | s 190, +3 m | PASS (12 rules) | 99 | PASS: Up the safety: rideOn, slid 1.03 s, clean exit; Kink joints: largest speed change in a tick 0.17 m/s; Ollie on from the water: from v=3.3 m, pop -1.3 m along the main (62 tries); registry 87/87 ticks |
| L4_Pyramid_01 (Pyramid) | Line 4 | 2 blue | base 8 x 8 m, top 2 x 2 m at 1.3 m | s 271, +4 m | PASS (8 rules) | 59 | PASS: Launch and land: lip 8.3 m/s at 29 deg, peak 2.11 m, air 1.17 s (plain 1.02), 10.1 m; registry 24/24 ticks |
| L4_WallRide_01 (Wall ride) | Line 4 | 3 black | 4 m face, 3 m tall, 78 deg, R 2 m | s 298, +2 m, yaw -0.6 | PASS (5 rules) | 61 | PASS: Up the wall and out: wallRide 0.55 s, 1.09 m up (aimed 0.0 m along, 0.6 m in); registry 33/33 ticks |
| L4_Spine_01 (Spine) | Line 4 | 3 black | 5 m ramp to 1.4 m (15 deg), 12 m landing | s 341, +3 m | PASS (5 rules) | 81 | PASS: Launch, land on the down slope: lip 8.1 m/s at 23 deg, peak 1.88 m, air 0.98 s (plain 0.85), 8.5 m, on the landing ramp; registry 42/42 ticks |
| L2_GapBox_01 (Gap box) | Line 2 | 3 black | 10 m from 0.80 m (was 6 m: see FEATURE_RIDING.md); 1 m wide; 1.2 m water gap | s 420, +3 m | PASS (12 rules) | 85 | PASS: Up the safety, pop in the window: popOn, slid 0.20 s, clean exit; Ollie on from the water: from v=2.4 m, pop -1.4 m along the main (87 tries); registry 33/33 ticks |
| L2_KinkRail_01 (Flat-down rail) | Line 2 | 3 black | 5 m + 5 m at -12 deg from 1.00 m; 0.3 m wide | s 453, +3 m | PASS (10 rules) | 65 | PASS: Up the safety: rideOn, slid 1.12 s, clean exit; Kink joints: largest speed change in a tick 0.11 m/s; Ollie on from the water: from v=1.2 m, pop -0.5 m along the main (58 tries); registry 93/93 ticks |
| L2_Transfer_01 (Transfer box) | Line 2 | 3 black | 2 x 6 m at 0.6 m, 0.8 m apart, 10 deg splay | s 489, +4 m | PASS (12 rules) | 116 | PASS: Up the safety: rideOn, slid 0.72 s, clean exit; Transfer A to B: pop at u=3.3 m, charge 0.35 s (3 tries); Ollie on from the water: from v=-3.5 m, pop -0.7 m along the main (80 tries); registry 59/59 ticks |
| L3_ProKicker_01 (Pro kicker) | Line 3 | 4 double black | 9 x 3.5 m, lip 1.9 m at 32 deg | s 520, +4 m | PASS (9 rules) | 68 | PASS: Launch (ideal pop): lip 8.2 m/s at 39 deg, peak 3.33 m, air 1.45 s (plain 1.28), 12.6 m [want 1.4-2.0 s]; registry 43/43 ticks |
| L3_Rooftop_01 (Rooftop) | Line 3 | 3 black | 4 m at 15 deg + 2 m + 4 m at -15 deg from 0.16 m; 0.8 m wide | s 552, +3 m | PASS (12 rules) | 93 | PASS: Up the safety: rideOn, slid 1.17 s, clean exit; Kink joints: largest speed change in a tick 0.16 m/s; Ollie on from the water: from v=-2.3 m, pop -1.3 m along the main (39 tries); registry 74/74 ticks |
| L3_StepUp_01 (Step-up rail) | Line 3 | 4 double black | 4 m from 0.50 m, gap, 5 m from 1.00 m; 0.3 m wide | s 15, +3 m | PASS (10 rules) | 66 | PASS: Up the safety: rideOn, slid 0.48 s, shortOllie into the high rail (expected); Pop up to the second rail: pop at u=5.2 m, charge 0.13 s (1 tries); Ollie on from the water: from v=-1.4 m, pop -1.3 m along the main (322 tries); registry 42/42 ticks |
| B_Slider_01 (Slider) | Beginner | 1 green | 8 m from 0.30 m; 1.2 m wide | s 28, +3 m | PASS (12 rules) | 69 | PASS: Up the safety: rideOn, slid 0.95 s, clean exit; Ollie on from the water: from v=-1.5 m, pop 1.1 m along the main (68 tries); registry 65/65 ticks |
| B_BeginnerKicker_01 (Beginner kicker) | Beginner | 1 green | 5 x 3 m, lip 0.6 m at 18 deg | s 62, +3 m | PASS (9 rules) | 63 | PASS: Launch (ideal pop): lip 8.0 m/s at 23 deg, peak 1.04 m, air 0.85 s (plain 0.73), 7.2 m [want 0.6-0.9 s]; registry 18/18 ticks |
| B_Funbox_01 (Funbox) | Beginner | 2 blue | 6 m from 0.60 m; 1.5 m wide; exit 2.2 m | s 96, +3 m | PASS (12 rules) | 95 | PASS: Up the safety: rideOn, slid 0.97 s, clean exit; Kink joints: largest speed change in a tick 0.15 m/s; Ollie on from the water: from v=3.0 m, pop -1.8 m along the main (59 tries); registry 75/75 ticks |

Screenshots (web game, which draws the FeatureBuilder's own parts):

- `docs/features/final-wake.jpg`: the 12 wake park features in place.
- `docs/features/final-beginner.jpg`: the beginner line.
- `docs/features/final-aerial.jpg`: the park from the air.
- `docs/features/maps.jpg`: top-down, the wake park and the beginner system.
- `docs/features/m5c.jpg` (wall ride and pyramid close up) and
  `docs/features/m8.jpg` (the realism details).

### Not done, or only checked indirectly

- **Not built or looked at in Roblox Studio.** No Studio connection here. The
  Luau runs under the plain `luau` CLI with a Roblox mock: models, tags,
  attributes, collision groups, registry, validator, ride test, bobbing, FX
  hooks, map, tags, stats, challenges and preview are all exercised there.
  The `--!strict` Park modules compile but were not type-checked against
  Roblox's API definitions. What needs a look in Studio:
  - lighting and shadows;
  - SurfaceGui decals;
  - particle looks;
  - BillboardGui sizes;
  - streaming.
- **No sound or image assets:** the sound ids are empty, and the decals are
  text and shape GUIs, not images.
- **Bidirectional features (pyramid, slider) are ridden one way only.** The
  loop never runs back past them. The attribute is set for gameplay code to
  read.
- **AllowedSlides is metadata.** The sim scores the four slide names on any
  box or rail, and the wall ride scores only `wallRide`.
- **The web game draws features static:** no bobbing, no foam (it is
  see-through).
- **Changes from the spec's numbers:**
  - spine landing slope 12 m;
  - wall ride turned 34 deg;
  - funbox and other safeties measured from the waterline;
  - lip-pop bonus 0.3;
  - transfer hop (A/D on the pop);
  - PopZoneLength 1.0 m;
  - lines fitted to the straights.

  The reasons are in the sections above.
