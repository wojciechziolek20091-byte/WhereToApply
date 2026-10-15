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
- [x] **M14 Cable wakeboarding mechanics spec.** The user's spec, milestones
  1-10, in the shared sim (both languages, parity-checked): 10-state rider FSM,
  raw input with taps and grab chords, rope cap/smoothing/yank, LOADED water
  tricks (raley, backroll, frontroll, S-bend, Mobe), ollie charge, spin/flip
  tracker with carry, handle passes and riding blind, grabs, lip pop, safety pop
  windows (flush/gap), slides with 90-degree steps and balance, crash reasons,
  trick tokens and names, combos, HUD meters and F3 debug, 2-tower test cable,
  spec test map, Roblox ContextActionService client, Beam rope, RemoteEvents,
  server validation and leaderstats. Tuning table in docs/TUNING.md.
- [x] **M13 Reversed cable.** Counter-clockwise travel; every feature keeps its
  spot on the water, turned to face the new direction.
- [x] **M12 Sketch layout.** The cable layout follows the user's sketch
  (house-shaped 5-tower loop, ~586 m, 10 features where the sketch puts them,
  round pipes as a new slider style); scenery rebuilt around it from the map.
- [x] **M11 Real park.** The default park is the user's lakeside cable park
  (map plus photos): 5 towers, ~595 m lap, island, starting dock between two
  kickers, 8 floating kickers and 4 rails in map order, watch terrace,
  clubhouse, tents, halls, parking, roads and fields. Same data in Luau
  (generated), drawn by both the web renderer and the Roblox client.

- [x] **A1-A11 Rider animation** (the animation spec): jointed rigs on the web
  and in Roblox, a layered procedural animator (poses as data, Hermite clips,
  springs, inertialized blends, two-bone IK with the handle as a real object,
  head aim, spine lead and spotting, COM pivot for inverts, grabs, slides,
  landings, crash lead-ins and a ragdoll), section 11 physics behind flags,
  VFX/camera/sound hooks, replication packets, F4/F6/F7 debug tools, a Luau
  twin with parity. docs/ANIMATION.md.

## Known limitations

- The rope is a straight spring-damper: no sag, no rope mass, no whip.
- Spins rotate only while the input is held; tuck only reshapes the speed
  within a turn (section 11), it is not a free angular-momentum model.
- Inverts auto-rotate one turn; the player only chooses when to stop extra rotation.
- Jib balance is a 1D model; there is no rail-to-rail transfer or presses.
- Judges are formula-based with a seeded bias, not a learned model.
- The raley swings about the board's long axis toward the toes, not exactly
  toward the cable (docs/ANIMATION.md lists what still looks stiff).
- Water is static faceted geometry; no waves.
- The sim does not know about land: the shoreline and island are placed out of
  reach instead (tests/site.test.ts). Riding into the bank is not a fall yet.
- No Roblox Studio session was available: the Roblox client and server scripts
  compile and the shared Sim and ComboValidator are tested in the luau CLI, but
  the Studio-only parts (ContextActionService, Beam, GUI, RemoteEvents,
  leaderstats, Motor6D posing, adornments, particles) have not been run in
  Studio. The animation and rig are checked by parity and under a mock.
- Sound hooks have no assets (AnimConfig.Sound ids are empty).
- R15 rigs are mapped (RigMap) but untested; the game uses its own rig.

## Backlog (later sessions)

- 2-tower system (straight shuttle with end reversals).
- Multiple carriers and other riders on the cable.
- Dock start.
- Gamepad input and analog edge.
- Rope mass and whip (the visual sags; the physics rope is still a spring).
- More features: A-frames, kinked rails, pipes, table tops, landing ramps.
- Tuning pass against video of real riders (speeds, air times, heights).
- Replay recording and playback UI.
- Trick input buffer and a proper trick UI.
- Presses (nose, tail) and spins on and off sliders.
- Corner tricks and rope-slack mechanics at towers (currently emergent only).
- Per-feature scoring of "use of course".
