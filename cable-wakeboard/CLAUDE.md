# Cable Wakeboard: notes for future sessions

A cable wakeboarding game foundation. Gray-box only. The physics core matters
more than visuals. This folder is self-contained; the rest of the repository is
an unrelated website (WhereToApply) and should not be touched from here.

## Commands

Run from `cable-wakeboard/`:

- `npm install`
- `npm run dev`: Vite dev server
- `npm test`: Vitest, run once
- `npm run test:watch`
- `npm run check`: `tsc --noEmit` over sim, game and tests (strict, no unused locals)
- `npm run build`: typecheck and production build to `dist/`
- `npx vite-node scripts/probe.ts` (and `probe-*.ts`): ad-hoc tuning probes that
  print sim state over a scripted input. Not tests; edit freely.

- `LUAU=/path/to/luau npm run test:parity`: TypeScript <-> Luau parity, sim and animation, plus the Roblox rig check (needs the
  `luau` CLI from https://github.com/luau-lang/luau/releases; skipped without LUAU)

Always run `npm run check && npm test` before committing, and the parity test
whenever `src/sim` or `roblox/src/shared/Sim` changes.

## Architecture

```
src/sim/      Pure TypeScript simulation. NO three.js, NO DOM, NO Math.random, NO Date.
  math/       vec.ts (Vec3 helpers), scalar.ts (clamp, wrap, approach), rng.ts (seeded),
              detmath.ts (sin, cos, tan, atan2, log, exp, pow from + - * / only),
              noise.ts (deterministic value noise, for feature balance)
  config.ts   SimConfig and DEFAULT_CONFIG. All tunables live here.
  cable.ts    Cable path (towers + filleted corners), carrier kinematics.
  park.ts     Park types (features, site) and resolvePark().
  parkLayout.ts Parks (docs/LAYOUT.md). WAKE_PARK (DEFAULT_PARK): the layout spec's
              target layout (WAKE_LAYOUT, spec format) placed by placeFeatures()
              from its own loop (WAKE_CABLE, towers on shore headlands, arms
              WAKE_TOWER_ARMS) round the grown lake (shoreFor). BEGINNER_PARK: the
              2-tower line (BEGINNER_CABLE, BEGINNER_LINE) in a lagoon inside the
              ring island (lagoonIsland). LAYOUT_RULES: the real-park rules.
              site.cables: both systems' towers (towerSites); site.buoyLayout:
              buoyLayout(). LAKESIDE_PARK: the user's sketch layout
              (docs/park-sketch.jpg) on the old lake and DEFAULT_CONFIG.cable.
              TEST_PARK: mechanics test map. CATALOG_TEST_PARK: every catalogue
              feature on the line (parity). WAKE_PARK_LAYOUT / placeLayout: the
              features spec's earlier lines, kept for reference.
              Luau copies of parkLayout.ts AND config.ts are GENERATED:
              `npx vite-node scripts/gen-luau-data.ts` -> Sim/ParkLayout.luau, Sim/Config.luau.
  features.ts Feature geometry queries.
  featureCatalog.ts The wake park feature catalogue (docs/FEATURES.md): 15 features'
              default dimensions + metadata. GENERATED to Sim/FeatureCatalog.luau.
  featureShapes.ts Catalogue entry (or a legacy kicker/slider def) -> ride pieces
              (role, part, u/h ends, power curve, splay, wall profile, pyramid cap)
              and shapeSurfaceAt. Hand-ported to Sim/FeatureShapes.luau (exact parity).
  rope.ts     Rope tension (one-sided spring-damper).
  edge.ts     Edge angle build/release, heading, toeSign.
  hydro.ts    Water forces, edge load.
  posture.ts  Handle distance, waist hinge, connection.
  pop.ts      Ollie charge, smoothed tension + peak tracking, water-trick timing/height.
  fsm.ts      Rider state machine: TRANSITIONS and transition() (asserts in debug).
  rotation.ts Spin/flip tracker with carry, frontside/backside from the rope.
  handle.ts   Handle system: pass zones and windows, spin to blind, coming out.
  waterTrick.ts Arming (LOADED), planning and phases of raley/rolls/S-bend.
  air.ts      Air integration: spins, flips, grabs, handle passes, water tricks.
  landing.ts  Landing evaluation and crash reasons.
  actions.ts  Shared transitions: applyRope (cap, smoothing, yank), crash, takeOff, touchDown.
  onFeature.ts Kicker ramps and lip pop, safety pop window, slides (90-degree
              steps, balance, passes), landing on a main, clearance check.
  rider.ts    RiderState and the mode / handle / crash types.
  input.ts    InputFrame (raw buttons) and InputMemory (presses, taps, grab chords).
  events.ts   SimEvent union emitted each tick.
  step.ts     stepSim(): one fixed tick, dispatching on rider.mode.
  world.ts    SimState, createSim().
  stepper.ts  FixedStepper accumulator.
  hash.ts     State hash for determinism tests.
  tricks/     data.ts (registry: names, points), classify.ts (tokens, names, points).
  scoring/    combo.ts (combo score, shared with the Roblox server), judges.ts (panel), metrics.ts.
  session.ts  createRun/stepRun: passes, crashes, respawn, trick log, combos, judges.
  index.ts    Public exports.
src/park/     (Roblox side is roblox/src/shared/Park: FeatureConfig, FeatureModel,
              FeatureBuilder, FeatureRegistry, FeatureValidator, FeatureRideTest,
              FeatureBob, ParkBuilder, Layout; docs/FEATURES.md.)
              featureConfig.ts: FeatureConfig (studs, collision groups, tags, the
              FeatureStyle palette `Style`, validator thresholds, buoys, bob, sounds).
              GENERATED to roblox/src/shared/Park/FeatureConfig.luau (--!strict).
              layoutValidator.ts: LayoutValidator (twin Park/LayoutValidator.luau,
              which adds the ride-data check). Other Park/ modules from the layout
              spec: FeatureStyle, VisualAudit, TowerBuilder (twin src/art/tower.ts),
              Buoys, PlaceFeatures (twin of placeFeatures), ParkBuilder.backup().
src/art/      Engine-free art: site.ts (polygon helpers, ear clipping, triangle builder
              for the park site), mesh.ts (primitives and hulls -> flat-shaded triangle
              arrays), riders.ts + riderParts.json (rider art exported from the Luau
              RiderBuilder by scripts/export-rider-art.sh). No engine imports.
src/anim/     Rider animation (docs/ANIMATION.md). Engine-free like the sim, but NOT
              bit-exact (Math.sin & co. are fine here). state.ts: RiderAnimState (the
              spec's contract) + animStateFromSim adapter. animator.ts: the layered
              system (base poses, trick clips, spring reactions, IK, spine lead,
              inertialized blends, COM pivot, hands and handle). poses.ts: every
              pose and clip as data. channels.ts (pose as numbers, mirrorPose),
              clip.ts (Hermite sampling), skeleton.ts (joints, FK, COM), ik.ts,
              spring.ts, quat.ts, ragdoll.ts, replication.ts (packets),
              testDriver.ts (scripted scenarios for the scrubber and tests),
              config.ts (AnimConfig, spec-style PascalCase keys).
src/render/   babylon/: the game's engine (Babylon.js). character.ts: the smooth rider
              from the user's character sheet (procedural shapes, colourways
              Sheet/A/B), jointed: one TransformNode per bone, applyFrame poses it;
              art/board.ts is its board.
              rot.ts: basis/quaternion helpers. BabylonRenderer.ts (scene,
              rider, water, forest, buoys, other riders, spray, wake, chase
              camera), looks.ts (DAY default, DUSK via ?look=dusk). graybox.ts: old
              three.js view, kept for debugging via ?renderer=graybox.
              Renderers read SimState; they never write it.
src/game/     Browser glue: animDebug.ts (F7 pose scrubber), keyboard.ts (keys -> raw InputFrame), hud.ts (tension meter
              with LOADED, trick feed and combo, pop timing bar, handle-pass ring,
              balance meter, help on H, debug overlay on F3), hud.css (imported
              ?inline and injected), main.ts loop (`?park=test` for the test map,
              F4 slow motion, F6 skeleton, F7 scrubber, `?scrub=Name&u=0.5`,
              `?clean=1` for captures, `?physics=old` for section 11 off).
src/render/pose.ts  Rider orientation shared by both renderers (twin: roblox RiderPose.luau).
scripts/      Tuning probes (vite-node).
roblox/       Roblox side (Luau, Rojo project): rider builder, dusk lighting, spray.
              src/shared/Sim/: the Luau twin of src/sim (one module per file,
              same names, same fields). src/shared/WakeInput.luau: actions and
              bindings -> InputFrame (twin of keyboard.ts). ComboValidator.luau:
              server checks. src/shared/Anim/: the Luau twin of src/anim.
              RigMap.luau, RiderRig.luau: animation frames -> Motor6Ds.
              src/client/WakeClient.client.luau: Studio client
              (ContextActionService, animated rig, Beam rope, VFX, HUD, debug keys,
              anim replication). src/server/WakeServer.server.luau:
              RemoteEvents, validation, leaderstats.
              See roblox/README.md. The Roblox rider (RiderBuilder.luau, faceted) is
              no longer the web rider; src/art/riderParts.json (its export) is kept
              for the art tests and the old look, refresh it with
              scripts/export-rider-art.sh <path/to/luau>.
tests/        Vitest specs, mostly for src/sim.
docs/MECHANICS.md  Sport mechanics and where each lives in code. Keep in sync.
PLAN.md       Milestones and backlog.
```

Data flow per frame: keyboard -> `InputFrame` -> `advanceStepper()` runs
`stepRun()` 0..n times at 60 Hz -> `SimState` (+ `events` for that tick) ->
renderer interpolates between the previous and current snapshot.

Rider modes (fsm.ts): `riding`, `ridingBlind`, `waterTrickLoad`, `waterTrickAir`,
`airborne`, `onKicker`, `onSafety`, `onFeature`, `landing`, `crashed`. Only
`transition()` changes the mode; illegal moves throw with `debug.enabled`.
Physics never names tricks: it emits `landed` (with the `AirState`) and
`slideDone` (with the `JibState`); the session classifies them with
`tricks/classify.ts` and chains them into combos.

In the browser console, `cable()` returns the live `RunState`. `?cam=front|back|side`
frames the rider close up for checking the character; `?cam=aerial` (drone view
from the south) and `?cam=map` (top-down, north up) show the whole park.

## Conventions

- SI units everywhere in the sim: m, s, kg, N, rad. Convert only for display.
- Coordinates: right-handed, +y up, water at y = 0. Heading `psi` is a yaw angle
  in the x-z plane: forward = (cos psi, 0, sin psi), right = (-sin psi, 0, cos psi).
  Positive psi turns clockwise seen from above. Three.js meshes whose forward is
  +x use `rotation.y = -psi`.
- Edge angle: positive heelside, negative toeside.
- Fixed timestep `DT = 1/60`. The sim must be deterministic: same config, seed
  and input sequence give the same state hash. Use `rng.ts`, never `Math.random`.
- Sim state is plain data (no classes with hidden state) so it can be hashed,
  cloned and serialised. Functions mutate the state passed to them; pure helpers
  return values.
- Tunables go in `config.ts`, not inline magic numbers.
- Tricks, grabs, spins, features are data. Add a trick by adding a row.
- Controls follow docs/MECHANICS.md section 4: A/D steer (the sim picks the edge
  from the stance), Space pop, S/W rolls (loaded) and flips (air), Q handle
  pass, E (+R/N/T) grabs, Shift arms out, X let go.
- When a mechanic changes, update `docs/MECHANICS.md` in the same commit.
- Tests live in `tests/`, named after the module (`rope.test.ts`).

## Two versions of the animation (TypeScript and Luau)

`src/anim` and `roblox/src/shared/Anim` are also twins, checked by
`tests/animParity.test.ts` (to 1e-6, not bit-exact) and
`tests/architecture.test.ts` (every TS module has its twin: animator ->
Animator, ik -> TwoBoneIK, state -> RiderAnimStateAdapter, replication ->
AnimReplication, testDriver -> AnimTestDriver, config -> AnimConfig,
poses -> RiderPoses). AnimConfig.luau and RiderPoses.luau are generated
(`scripts/gen-luau-data.ts`). Luau channel arrays are 1-based; the replication
packet's Luau indices are the TS index + 1. The Roblox glue (RiderBuilder rig,
RigMap, RiderRig) is checked under the mock by `tests/robloxRig.test.ts`.

## Two versions of the sim (TypeScript and Luau)

`src/sim` (TypeScript) and `roblox/src/shared/Sim` (Luau) are the same program
and must stay bit-identical. **Every change to sim logic is made in both, in the
same commit**, then `npm run test:parity` must pass. The TypeScript side is the
one to edit first (it has the unit tests); then mirror it line by line.

- File map: `foo.ts` -> `Foo.luau`, `math/foo.ts` -> `Foo.luau`,
  `tricks/data.ts` -> `TricksData.luau`, `scoring/judges.ts` -> `ScoringJudges.luau`.
  `init.luau` is `index.ts`. `hash.ts`, `events.ts`, `rider.ts` are TypeScript-only
  (types and test tooling). `tests/architecture.test.ts` fails if a module is missing.
- Requires: `require(script.Parent.Foo)` inside Sim; from outside,
  `require(ReplicatedStorage.WakeShared.Sim)`.
- Numbers: never `Math.sin/cos/tan/atan2/pow/exp/log/hypot` or `**` in the sim
  (V8 and C libm differ in the last bit); use `math/detmath.ts` / `DetMath.luau`.
  `Math.sqrt`, `abs`, `min`, `max`, `floor` and + - * / are exact in both.
- JS `%` is `math.fmod` (Luau `%` floors). `Math.round` is `Scalar.round`.
  `Math.imul` is `Rng.imul`. Spread `{ ...a }` is `table.clone(a)`.
- `null` is `nil`. Arrays are 1-based in Luau: watch `find`, `[0]`, `slice`.
  `local` is a keyword: `hit["local"]`.
- Vectors are plain `{x, y, z}` tables, never Roblox `Vector3` (float32).
- Keep the operation order of every expression: `a * b * c` and `a * (b * c)`
  round differently.
- The Luau Sim must not touch Roblox APIs (`game`, `Instance`, `Vector3`,
  `task`, `os`, `math.random`), so it also runs in the plain `luau` CLI.
- Data: edit `src/sim/config.ts` or `src/sim/parkLayout.ts`, then regenerate
  the Luau copies (`npx vite-node scripts/gen-luau-data.ts`); never edit
  Config.luau or ParkLayout.luau by hand. The parity test compares
  DEFAULT_CONFIG and DEFAULT_PARK across the two.
- Parity tooling: `tests/parity/trace.ts` and `roblox/tests/sim_trace.luau` are
  twins (same scripted input, same trace fields); `tests/parity/luauBundle.ts`
  bundles the Luau modules for the CLI. A failure prints the first differing
  tick and field.

## Map coordinates

The park sketch (`docs/park-sketch.jpg`) was converted at 0.24 m per pixel,
north up: x east, z south (so `?cam=map` looks like the sketch). Travel is
counter-clockwise from above; `offset` < 0 is inside the loop, > 0 outside.
To reverse the direction: reverse the tower order (keep s = 0 on the south
straight), and re-project each feature's centre onto the new path (its side of
the line flips sign; its `s` becomes the new centre minus half its length).

## Tuning reference (defaults; full table in docs/TUNING.md)

- Trailing flat behind the carrier: about 380 N at 8.3 m/s.
- Hard heelside cut: passes 1000 N (smoothed) in about 0.9 s, peaks about 1.4 kN,
  LOADED for about 1.2 s.
- Ollie: 3.5 to 6.5 m/s (0.6 to 2 m of air) with 0 to 0.5 s of charge.
- Raley released at the tension peak: about 2.5 m, 1.5 s of air.
- A 1.2 m kicker straight: about 1.9 m peak; a lip pop adds about 15%.

Layout: `npx vite-node scripts/probe-layout.ts` (validator table),
`scripts/probe-lap-shore.ts` (lap test: shore, tower, buoy distances).
Features are white and rails black through FeatureStyle only; visuals sit
FeatureConfig.VisualDrop studs under ride surfaces (VisualAudit fails a
test otherwise). After changing parkLayout.ts or FeatureBuilder: regenerate
(`gen-luau-data.ts`, `export-feature-art.ts` with LUAU set).

Probes: `scripts/probe-tension.ts` (milestone 2 log), `probe-air.ts`,
`probe-water.ts`, `probe-features.ts`, `probe-tuning.ts` (every trick 5 times).
`tests/riding.test.ts`, `air.test.ts`, `waterTrick.test.ts` and
`features.test.ts` pin these loosely.

## Gotchas

- Animation rest poses must stay mirror-symmetric (tests check both rigs):
  goofy and switch riders are the regular pose mirrored, and the rig is
  turned half round. Keep RiderBuilder's TorsoLean/Twist/HeadTurn at 0.
- Bone rest orientation is identity in both rigs, so a joint's local rotation
  is its Motor6D.Transform / TransformNode rotation. Babylon quaternions
  take ours as-is (tests/character.test.ts checks it).
- Rope stiffness stands in for the body; raising it a lot needs a smaller
  timestep or the rope will ring.
- Import Babylon per module (`@babylonjs/core/Meshes/mesh`, not `@babylonjs/core`):
  the barrel import makes `vite build` take minutes and gigabytes of RAM.
  Classes that need scene components get a bare side-effect import next to them.
- Babylon runs with `scene.useRightHandedSystem = true` so sim, three.js, Roblox
  and Babylon share one convention. Babylon matrices are row-vector: basis
  vectors go in the rows.
- `tests/architecture.test.ts` fails if anything under `src/sim` or `src/art` imports three, Babylon
  or uses `Math.random` / `Date.now` / `performance` / `window` / `document`
  (comments are ignored).
- Physics tests use `flatSim()` (no features, started on the long east
  straight) so riders do not hit a kicker or a corner mid-test; feature tests
  use `featureSim(def)` with a one-feature park.
- `events` is cleared at the start of every tick. Consume them right after
  `stepSim()` / `stepRun()`.
- Input is raw buttons; the sim converts A/D to an edge (`carveToEdge`) and to
  spin directions, and decides frontside/backside from the rope. Keep input
  mapping (keyboard.ts, WakeInput.luau) free of game logic.
- `cfg.debug.enabled` makes illegal transitions throw and logs `transition`
  events; tests rely on it.
