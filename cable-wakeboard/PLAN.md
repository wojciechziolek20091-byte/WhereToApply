# Plan

Foundation for a cable wakeboarding game. Physics core and structure first,
gray-box visuals, no art or audio. Each milestone ends with tests passing and a
commit.

## Assumptions

The original brief was written for boat wakeboarding and was cut off partway
through "What to build". It was then redirected to **cable wakeboarding** in a
purpose-built park. Assumptions made to fill the gaps:

- The sim works in the **park (world) frame**, not a moving frame: the cable is
  fixed, the carrier moves along it. Y is up, the water surface is y = 0.
- Air comes from features (kickers, sliders) and from line tension off flat
  water. There is no boat wake.
- A "pass" is one lap of the cable; a run is two passes.
- After a fall the rider respawns on the next straight (a game convenience; in
  a real park you swim out and wait). Configurable.
- Input is keyboard only for now.

## Milestones

- [x] **M0 Docs and scaffold.** MECHANICS.md, PLAN.md, CLAUDE.md. Vite + TS +
  Vitest + Three.js project, strict tsconfig, `npm test` and `npm run check`.
- [x] **M1 Sim math, config, cable.** Vector and angle helpers, seeded RNG,
  `SimConfig` defaults, cable path with filleted corners, carrier kinematics,
  fixed-step accumulator. Tests for path length, continuity, wrap-around.
- [x] **M2 Rope and riding.** Rope tension, hydro forces, edge build and heading,
  posture and connection, rider state, `stepSim()`. Tests: trailing equilibrium,
  edging swings the rider out and raises tension and speed, progressive edge.
- [x] **M3 Pop, air, landing, falls.** Load tracker, `computePop()`, air
  rotation, landing evaluation and every fall kind. Tests per fall, pop
  monotonicity, backing off kills pop.
- [x] **M4 Features.** Kickers and sliders as data, surface queries, riding the
  ramp, launching at the lip, jib balance, crashes. Tests: kicker launch, timed
  pop beats untimed, slider balance.
- [x] **M5 Tricks as data.** Catalogue (jumps, spins, inverts, raleys, grabs,
  combos, jibs) and classifier. Table tests for the six basic inverts, the
  scarecrow, switch and blind spins.
- [x] **M6 Scoring and run session.** Metrics from events, three-judge panel,
  passes and falls. Tests: weights, determinism, falls hurt execution, variety
  helps composition, two falls end a run.
- [x] **M7 Gray-box renderer and input.** Three.js scene from primitives,
  interpolated rendering, chase camera, keyboard mapping, HUD with tension and
  edge load.
- [x] **M8 Determinism and guards.** Replay test (same inputs, same state hash),
  architecture test (no `three` or `Math.random` in `src/sim`), CLAUDE.md
  final pass.

- [x] **M9 Game engine.** Babylon.js renderer with the faceted low-poly art
  shared with Roblox (exported from RiderBuilder.luau), dusk sky and sun,
  faceted water and features, pastel spray, rider picker. Deployed as a web game.
- [x] **M10 Luau twin.** The whole sim ported line by line to Luau
  (`roblox/src/shared/Sim`), deterministic math (`detmath`) in both so they
  stay bit-identical, a parity test that plays three full scripted runs through
  both and compares every tick, and a thin Roblox client (`WakeClient`) for Studio.
- [x] **M11 Real park.** The default park is the user's lakeside cable park
  (map plus photos): 5 towers, ~595 m lap, island, starting dock between two
  kickers, 8 floating kickers and 4 rails in map order, watch terrace,
  clubhouse, tents, halls, parking, roads and fields. Same data in Luau
  (generated), drawn by both the web renderer and the Roblox client.

## Known limitations

- The rope is a straight spring-damper: no sag, no rope mass, no whip.
- Spins rotate only while the input is held; there is no angular momentum.
- Inverts auto-rotate one turn; the player only chooses when to stop extra rotation.
- Raley and invert visuals are rough approximations of the body.
- Jib balance is a 1D model; there is no rail-to-rail transfer or presses.
- Judges are formula-based with a seeded bias, not a learned model.
- Rider is one rigid mesh: no limb animation for crouch, grabs or raleys yet.
- Water is static faceted geometry; no waves or wake trail.
- The sim does not know about land: the shoreline and island are placed out of
  reach instead (tests/site.test.ts). Riding into the bank is not a fall yet.
- The Roblox client (`roblox/src/client`) has not been run in Studio yet: the
  sim under it is verified, the camera, scale and HUD are a first pass. It does
  not mirror the rider for goofy/switch.

## Backlog (later sessions)

- 2-tower system (straight shuttle with end reversals).
- Multiple carriers and other riders on the cable.
- Dock start.
- Gamepad input and analog edge.
- Rope sag and a proper rope visual.
- More features: A-frames, kinked rails, pipes, table tops, landing ramps.
- Tuning pass against video of real riders (speeds, air times, heights).
- Replay recording and playback UI.
- Trick input buffer and a proper trick UI.
- Presses (nose, tail) and spins on and off sliders.
- Corner tricks and rope-slack mechanics at towers (currently emergent only).
- Per-feature scoring of "use of course".
