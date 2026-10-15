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

- `LUAU=/path/to/luau npm run test:parity`: TypeScript <-> Luau parity (needs the
  `luau` CLI from https://github.com/luau-lang/luau/releases; skipped without LUAU)

Always run `npm run check && npm test` before committing, and the parity test
whenever `src/sim` or `roblox/src/shared/Sim` changes.

## Architecture

```
src/sim/      Pure TypeScript simulation. NO three.js, NO DOM, NO Math.random, NO Date.
  math/       vec.ts (Vec3 helpers), scalar.ts (clamp, wrap, approach), rng.ts (seeded),
              detmath.ts (sin, cos, tan, atan2, log, exp, pow from + - * / only)
  config.ts   SimConfig and DEFAULT_CONFIG. All tunables live here.
  cable.ts    Cable path (towers + filleted corners), carrier kinematics.
  park.ts     Park types (features, site) and resolvePark().
  parkLayout.ts The default park: layout from the user's sketch (docs/park-sketch.jpg),
              scenery from their park map. Features, start dock, site
              (shore, island, buildings...). Luau copy is GENERATED:
              `npx vite-node scripts/gen-park-luau.ts` -> Sim/ParkLayout.luau.
  features.ts Feature geometry queries.
  rope.ts     Rope tension (one-sided spring-damper).
  edge.ts     Edge angle build/release, heading, toeSign.
  hydro.ts    Water forces, edge load.
  posture.ts  Handle distance, waist hinge, connection.
  pop.ts      Load tracker and computePop().
  air.ts      Air integration and rotation.
  landing.ts  Landing evaluation and fall kinds.
  actions.ts  Shared rider transitions: applyRope, takeOff, touchDown, fallRider.
  onFeature.ts Riding kickers and sliders, jib balance, landing on features.
  rider.ts    RiderState.
  input.ts    InputFrame (what the player asks for in one tick).
  events.ts   SimEvent union emitted each tick.
  step.ts     stepSim(): one fixed tick, dispatching on rider.mode.
  world.ts    SimState, createSim().
  stepper.ts  FixedStepper accumulator.
  hash.ts     State hash for determinism tests.
  tricks/     data.ts (catalogue), classify.ts.
  scoring/    judges.ts (panel), metrics.ts.
  session.ts  createRun/stepRun: passes, falls, respawn, trick log, scoring.
  index.ts    Public exports.
src/art/      Engine-free art: site.ts (polygon helpers, ear clipping, triangle builder
              for the park site), mesh.ts (primitives and hulls -> flat-shaded triangle
              arrays), riders.ts + riderParts.json (rider art exported from the Luau
              RiderBuilder by scripts/export-rider-art.sh). No engine imports.
src/render/   babylon/: the game's engine (Babylon.js). character.ts: the smooth rider
              from the user's character sheet (procedural shapes, two-bone IK pose,
              colourways Sheet/A/B, one merged mesh); art/board.ts is its board.
              rot.ts: basis/quaternion helpers. BabylonRenderer.ts (scene,
              rider, water, forest, buoys, other riders, spray, wake, chase
              camera), looks.ts (DAY default, DUSK via ?look=dusk). graybox.ts: old
              three.js view, kept for debugging via ?renderer=graybox.
              Renderers read SimState; they never write it.
src/game/     Browser glue: keyboard.ts (keys -> InputFrame), hud.ts (tiles, trick
              popup, help on H), hud.css (imported ?inline and injected, so the
              published page needs no CSS of its own), main.ts loop.
scripts/      Tuning probes (vite-node).
roblox/       Roblox side (Luau, Rojo project): rider builder, dusk lighting, spray.
              src/shared/Sim/: the Luau twin of src/sim (one module per file,
              same names, same fields). src/shared/WakeInput.luau: keys -> InputFrame
              (twin of keyboard.ts). src/client/WakeClient.client.luau: Studio client.
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

Rider modes: `riding` (water) -> `feature` (kicker/slider) -> `air` -> back to
`riding`/`feature`, or `fallen` (session respawns after `landing.fallRecovery`).
Physics never names tricks: it emits `landed` with the `AirState`, and the
session classifies it with `tricks/classify.ts`.

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
- When a mechanic changes, update `docs/MECHANICS.md` in the same commit.
- Tests live in `tests/`, named after the module (`rope.test.ts`).

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
- Park data: edit `src/sim/parkLayout.ts`, then regenerate the Luau copy
  (`npx vite-node scripts/gen-park-luau.ts`); the parity test compares
  DEFAULT_CONFIG and DEFAULT_PARK across the two. Towers live in both
  `config.ts` and `Config.luau` (by hand).
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

## Tuning reference (defaults, flat water)

- Trailing flat behind the carrier: about 380 N at 8.3 m/s.
- Hard cut: 1.5 to 2.8 kN, up to about 45 km/h, about 11 m out from the line.
- Well-timed flat-water pop: about 4.7 m/s, 1.3 s air, 1.3 m peak.
- A 1.1 m kicker (lip 0.5 rad) straight with no pop: about 1.1 s air, 1.8 m peak.

`tests/riding.test.ts`, `pop.test.ts` and `features.test.ts` pin these loosely;
retune the numbers there if a deliberate tuning change moves them.

## Gotchas

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
- Physics tests use `flatSim()` (no features) so riders do not hit a kicker
  mid-test; feature tests build their own one-feature park.
- `events` is cleared at the start of every tick. Consume them right after
  `stepSim()` / `stepRun()`.
- The game layer converts screen-relative steering to the sim's edge and spin
  conventions (`carveToEdge`, `-toeSign` for frontside). Keep the sim's input
  in rider terms.
