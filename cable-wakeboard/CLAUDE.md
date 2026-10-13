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
- `npm run check`: `tsc --noEmit` over sim, game and tests
- `npm run build`: typecheck and production build to `dist/`

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
  rider.ts    RiderState.
  input.ts    InputFrame (what the player asks for in one tick).
  events.ts   SimEvent union emitted each tick.
  step.ts     stepSim(): one fixed tick.
  world.ts    SimState, createSim().
  stepper.ts  FixedStepper accumulator.
  hash.ts     State hash for determinism tests.
  tricks/     data.ts (catalogue), classify.ts.
  scoring/    judges.ts (panel), metrics.ts.
  session.ts  RunSession: passes, falls, respawn, trick log, scoring.
src/render/   Three.js gray-box renderer. Reads SimState; never writes it.
src/game/     Browser glue: keyboard -> InputFrame, HUD, main loop.
tests/        Vitest specs, mostly for src/sim.
docs/MECHANICS.md  Sport mechanics and where each lives in code. Keep in sync.
PLAN.md       Milestones and backlog.
```

Data flow per frame: keyboard -> `InputFrame` -> `FixedStepper` runs
`RunSession.step()` 0..n times at 60 Hz -> `SimState` (+ events) -> renderer
interpolates between the previous and current snapshot.

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

## Gotchas

- Rope stiffness stands in for the body; raising it a lot needs a smaller
  timestep or the rope will ring.
- `tests/architecture.test.ts` fails if anything under `src/sim` imports three
  or uses `Math.random` / `Date.now` / `performance`.
