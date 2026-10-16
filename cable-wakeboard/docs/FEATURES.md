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
