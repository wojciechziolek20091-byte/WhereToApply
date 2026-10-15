# Cable Wakeboard: Roblox

The Roblox side of the game: the full game simulation (a Luau twin of the web
game's TypeScript sim), a Studio client, and the visual style and rider
character. Art is Luau, primitives only (Block, Wedge, Ball, Cylinder; CornerWedge is allowed but not
needed yet), SmoothPlastic, no textures, decals or faces.

![Three palettes, previewed outside Roblox](docs/rider-preview.png)

The preview above is a browser render of the exact parts the builder makes
(sizes, CFrames and colours exported from a Luau run), not a Studio
screenshot. Studio lighting will differ.

## Files

```
default.project.json            Rojo project: shared -> ReplicatedStorage.WakeShared,
                                server -> ServerScriptService.WakeServer,
                                client -> StarterPlayer.StarterPlayerScripts.WakeClient
src/shared/Sim/                 The game simulation, one ModuleScript per file (init.luau
                                is the folder's module). Same code as ../src/sim.
src/shared/WakeInput.luau       ContextActionService action names and keys -> InputFrame
                                (same controls as the web game), CONTROLS_HELP text
src/shared/Anim/                The rider animation system, one ModuleScript per file (twin
                                of ../src/anim; see ../docs/ANIMATION.md): Animator,
                                RiderAnimStateAdapter, TwoBoneIK, Ragdoll, AnimReplication,
                                AnimTestDriver, generated AnimConfig and RiderPoses
src/shared/RiderPose.luau       Board orientation from the sim (yaw, inverts, edge), used by
                                the adapter (same as ../src/render/pose.ts)
src/shared/RiderRig.luau        An animation frame -> the rig: PivotTo, Motor6D.Transform,
                                the handle model
src/shared/RigMap.luau          Animation joints -> Motor6D names (WakeRider rig and R15)
src/shared/ComboValidator.luau  Server-side checks of a reported combo: trick points,
                                combo factors and totals against the sim's tables
src/shared/SiteGeometry.luau    Polygon helpers (ear clipping) for drawing the park site
src/client/WakeClient.client.luau  Plays the sim: the park from the sketch and map (water,
                                banks, island, dock, terrace, buildings, roads), rider,
                                rope (Beam, white to red with tension), chase camera, HUD
                                (tension, combo, timing, handle, balance), F3 debug,
                                crash tumble; fires TrickLanded / ComboEnded / Crashed
src/server/WakeServer.server.luau  Creates ReplicatedStorage.WakeRemotes, validates every
                                ComboEnded with ComboValidator, keeps leaderstats
                                (Points, Best Combo)
src/shared/RiderBuilder.luau    RiderBuilder.build(options) -> jointed Model (Motor6D per
                                joint), RiderBuilder.rigDef(options) -> the animator's rig
src/shared/DuskLighting.luau    DuskLighting.apply(): sky, haze, sun, post effects
src/shared/WaterSpray.luau      WaterSpray.attach(rider), setIntensity(emitter, 0..1)
src/server/Showcase.server.luau Lake, rocks and one rider per palette, for judging the look
tests/mock_roblox.luau          Tiny Roblox API mock for running the builder outside Studio
tests/rider_spec.luau           Smoke tests: classes, material, welds, height, shades, toggles
tests/run.sh                    Bundles mock + module + spec and runs them with `luau`
tests/sim_trace.luau            Scripted run printed tick by tick (parity test, Luau half)
tests/anim_trace.luau           Animation frames for a seeded run and every scenario (parity)
tests/rig_anim_spec.luau        Motor6D chains vs the animator, under the mock
```

## Getting it into Studio

Everything here is plain files laid out for Rojo, so exporting is a copy, not a
conversion. Either:

- **Rojo (recommended):** install Rojo and its Studio plugin, run `rojo serve`
  in this folder, and click Connect in the plugin. Or `rojo build -o
  CableWakeboard.rbxlx` and open the place file.
- **Studio MCP (local Claude session):** ask Claude to recreate the tree from
  `default.project.json`: a ModuleScript per file in `src/shared` under
  `ReplicatedStorage.WakeShared`, with `Sim` and `Anim` as ModuleScripts made
  from their `init.luau` and every other file in each folder as a child
  ModuleScript of it;
  `src/client/WakeClient.client.luau` as a LocalScript in
  `StarterPlayer.StarterPlayerScripts`; `src/server/WakeServer.server.luau` as a
  Script in `ServerScriptService`; then press Play.
- **By hand:** the same tree, pasting each file into a script of the same name.

`Showcase.server.luau` (the style lineup) and `WakeClient` both build into the
workspace; disable Showcase when playing.

## The simulation

```lua
local Sim = require(game.ReplicatedStorage.WakeShared.Sim)
local run = Sim.Session.createRun() -- default config and park
Sim.Session.stepRun(run, Sim.Input.neutralInput()) -- one 60 Hz tick
print(run.sim.rider.pos.x, run.points, run.pass)
```

Riding physics runs on the client (one sim per player, 60 Hz). The server never
simulates; it only checks what the client reports (`ComboValidator.validate`):
each trick's points must match the trick tables, the multiplier and factors must
follow `Config.combo`, and the total must add up. Rejected combos score nothing.

## Controls

| Keys | On water | In the air | On a box / rail |
|---|---|---|---|
| A / D | carve | spin | tap to balance, hold to turn 90° |
| Space | hold to charge, release to pop (raley when LOADED) | | pop off |
| S / W + Space | backroll / frontroll when LOADED | front flip / tantrum (W / S) | |
| Q | | handle pass in the ring window | handle pass |
| E (+R / N / T) | | indy (stalefish / nose / tail) | |
| Shift | | | arms out |
| X | let go | let go | let go |
| F3, Enter | debug overlay, restart (web also: P pause, H help) | | |

On a blind landing (handle behind the back), tap A / D the way you came to spin
out, or pop and spin out. A / D during a raley is an S-bend.

The test map (`ParkLayout.TEST_PARK`: one kicker, flush box, gap box, 8 m
rail on a straight two-tower line) is picked with `Sim.Session.createRun(nil,
Sim.ParkLayout.TEST_PARK)` in Luau or `?park=test` in the web game.

Module for module, field for field, the same as `../src/sim`: what the web
game does, this does, to the last bit. `npm run test:parity` (from the parent
folder) proves it: it plays three complete scripted runs (carving, pops,
spins, grabs, jibs, falls, respawns, two passes, judges' scores) through both
and compares every value on every tick. Rules for keeping the two in step are
in `../CLAUDE.md` ("Two versions of the sim").

The park itself (`Sim/ParkLayout.luau`: features, start dock, shoreline,
island, buildings) is generated from `../src/sim/parkLayout.ts`; regenerate it,
and `Sim/Config.luau`, with `npx vite-node scripts/gen-luau-data.ts` after editing
`../src/sim/parkLayout.ts` or `../src/sim/config.ts`. Never edit the two generated files
by hand.

Units are metres in the sim; `WakeClient` converts to studs (1 stud = 0.28 m).
Vectors are plain `{x, y, z}` tables of doubles, not `Vector3` (float32).

`WakeClient` and `WakeServer` are a first pass that has not been run in Studio
yet; the sim and animation under them (parity-tested against TypeScript),
`ComboValidator` (run against a real sim run) and the rig's Motor6D chains
(checked against the animator under the mock) are the verified part.

## Animation

```lua
local Anim = require(game.ReplicatedStorage.WakeShared.Anim)
local RiderRig = require(game.ReplicatedStorage.WakeShared.RiderRig)
local model = RiderBuilder.build({ palette = "Sheet" })
local rig = RiderRig.new(model, RiderBuilder.Config.Rig.MetresPerStud)
local animator = Anim.Animator.create(RiderBuilder.rigDef({ palette = "Sheet" }))
RunService.PreSimulation:Connect(function(dt)
	local state = Anim.Adapter.fromSim(run.sim, eventsSinceLastFrame, lastState)
	RiderRig.apply(rig, Anim.Animator.step(animator, state, dt))
end)
```

The rig is RiderBuilder's own: one invisible `Bone<Joint>` part per joint
(Hips, Waist, Neck, L/R Shoulder, Elbow, Wrist, Hip, Knee, Ankle; L is the lead
side), a Motor6D named after the joint, every visual part welded to its bone,
and the tow handle as a separate `Handle` model. The rest pose is upright and
mirror-symmetric, so goofy and switch riders are mirrored poses (never extra
clips). WakeClient keys: F4 slow motion, F6 skeleton overlay, F7 pose
scrubber (`[` `]` clip, `-` `=` phase). Other players' riders are animated from
18 Hz anim-state packets (UnreliableRemoteEvent `AnimState`, relayed by
WakeServer). Details and the list of what is still stiff: ../docs/ANIMATION.md.

## Using the builder

```lua
local RiderBuilder = require(game.ReplicatedStorage.WakeShared.RiderBuilder)
local rider = RiderBuilder.build({
	palette = "B", -- "A", "B", "Sheet", or a full palette table
	proportions = { HeadSize = 0.9, BootSize = 1.15 }, -- any CONFIG.Proportions key
	accessories = { Ponytail = true }, -- Helmet, Hair, Ponytail, Handle, Board
	board = "Sage", -- "Sage" (default), "Classic", or a full BoardStyle table
	seed = 3, -- facet layout; same seed, same rider
})
rider:PivotTo(CFrame.new(0, 0.05, 0))
rider.Parent = workspace
```

`Root` is the PrimaryPart (invisible, anchored, centre of the board base);
the board is welded to it and the body hangs off it through the Motor6Ds, so
one `PivotTo` moves the whole rider. The handle's bar has Attachments
`RopeAttachment`, `GripL` and `GripR`.

Rider space matches the web sim: +X is the direction of travel (board nose,
toward the carrier), +Y up, +Z the toe side. To place a rider from the sim's
heading `psi`, use `CFrame.new(x, y, z) * CFrame.Angles(0, -psi, 0)`.

## How the style is made

All colours and proportions are in the `CONFIG` table at the top of
`RiderBuilder.luau`, each with a comment.

- Each body segment is several overlapping chunks, each rotated up to
  `ChunkTilt` degrees off its neighbour, plus a thin wedge facet on every
  other chunk.
- Neighbouring chunks differ by `ShadeStep` (6 percent) lightness steps of the
  same hue, which fakes facet lighting.
- Head: a plain skin block and one wedge for the face plane. Helmet: banded
  block, a 45-degree band for an octagonal shell, sloped dome wedges, a brim
  wedge, vents.
- Slim, shaped body: torso sections taper from chest to waist (`TorsoSections`),
  limbs have an octagonal cross-section (each chunk plus a copy turned 45
  degrees), and shoulders, elbows, hips and knees are faceted balls.
- Slightly oversized gloves and chunky boots, legs with a knee bend, a bevelled
  board with rocker and a tow handle in both hands.

Boards (`CONFIG.Board` for the shape, `CONFIG.BoardStyles` for colourways):
**Sage** (default, from the user's board reference: sage green deck, darker
rail layer, black bindings with copper buckles, insert dots, a handle slot and
a pale slash graphic on the base; the reference's logo and sticker are left
out) and **Classic** (charcoal with an accent stripe, no binding hardware).
The rocker is a chain of segments turned up 3, 7 and 13 degrees, and the tips
step in with a narrower end cap for a rounded-square outline.

![Sage board: top, base, side, three-quarter](docs/board-preview.png)

Palettes: **A** (royal blue jacket, purple-grey pants, lime gloves and boots,
blue helmet), **B** (green jacket, brick red pants, yellow-orange accents,
ponytail), **Sheet** (two-tone sage and navy hoodie, navy cargo pants, red
vented helmet, black boots with cream soles, from the user's turnaround sheet;
colours and clothing only).

## Tests

```
tests/run.sh /path/to/luau                       # rider builder smoke tests (rig included)
cd .. && LUAU=/path/to/luau npm run test:parity  # sim and animation: Luau vs TypeScript; rig chains
```

Needs the `luau` CLI from https://github.com/luau-lang/luau/releases. The mock
covers only what RiderBuilder uses; DuskLighting and WaterSpray are checked for
syntax only (`luau-compile --null`) and need a look in Studio.
