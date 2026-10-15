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

Always run `npm run check && npm test` before committing.

## Architecture

```
src/sim/      Pure TypeScript simulation. NO three.js, NO DOM, NO Math.random, NO Date.
  math/       vec.ts (Vec3 helpers), scalar.ts (clamp, wrap, approach), rng.ts (seeded)
  config.ts   SimConfig and DEFAULT_CONFIG. All tunables live here.
  cable.ts    Cable path (towers + filleted corners), carrier kinematics.
  park.ts     Park layout and feature data (kickers, sliders).
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
src/art/      Engine-free art: mesh.ts (primitives and hulls -> flat-shaded triangle
              arrays), riders.ts + riderParts.json (rider art exported from the Luau
              RiderBuilder by scripts/export-rider-art.sh). No engine imports.
src/render/   babylon/: the game's engine (Babylon.js): BabylonRenderer.ts (scene,
              rider, water, forest, buoys, other riders, spray, wake, chase
              camera), looks.ts (DAY default, DUSK via ?look=dusk). graybox.ts: old
              three.js view, kept for debugging via ?renderer=graybox.
              Renderers read SimState; they never write it.
src/game/     Browser glue: keyboard.ts (keys -> InputFrame), hud.ts (tiles, trick
              popup, help on H), hud.css (imported ?inline and injected, so the
              published page needs no CSS of its own), main.ts loop.
scripts/      Tuning probes (vite-node).
roblox/       Roblox side (Luau, Rojo project): rider builder, dusk lighting, spray.
              See roblox/README.md. RiderBuilder.luau is the source of truth for
              rider art: after changing it, run scripts/export-rider-art.sh
              <path/to/luau> to refresh src/art/riderParts.json for the web game.
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

In the browser console, `cable()` returns the live `RunState`.

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

## Tuning reference (defaults, flat water)

- Trailing flat behind the carrier: about 380 N at 8.3 m/s.
- Hard cut: 1.5 to 2.8 kN, up to about 45 km/h, about 11 m out from the line.
- Well-timed flat-water pop: about 4.7 m/s, 1.3 s air, 1.3 m peak.
- Kicker 1 (1.1 m, lip 0.5 rad) straight with no pop: about 1.1 s air, 1.8 m peak.

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
