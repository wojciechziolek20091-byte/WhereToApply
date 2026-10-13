# Cable Wakeboard: Roblox

The Roblox side of the game: visual style and the rider character. Luau,
primitives only (Block, Wedge, Ball, Cylinder; CornerWedge is allowed but not
needed yet), SmoothPlastic, no textures, decals or faces.

![Three palettes, previewed outside Roblox](docs/rider-preview.png)

The preview above is a browser render of the exact parts the builder makes
(sizes, CFrames and colours exported from a Luau run), not a Studio
screenshot. Studio lighting will differ.

## Files

```
default.project.json            Rojo project: shared -> ReplicatedStorage.WakeShared,
                                server -> ServerScriptService.WakeServer
src/shared/RiderBuilder.luau    RiderBuilder.build(options) -> Model
src/shared/DuskLighting.luau    DuskLighting.apply(): sky, haze, sun, post effects
src/shared/WaterSpray.luau      WaterSpray.attach(rider), setIntensity(emitter, 0..1)
src/server/Showcase.server.luau Lake, rocks and one rider per palette, for judging the look
tests/mock_roblox.luau          Tiny Roblox API mock for running the builder outside Studio
tests/rider_spec.luau           Smoke tests: classes, material, welds, height, shades, toggles
tests/run.sh                    Bundles mock + module + spec and runs them with `luau`
```

## Getting it into Studio

Either:

- **Rojo:** install Rojo and its Studio plugin, run `rojo serve` in this folder,
  and click Connect in the plugin.
- **Studio MCP (local Claude session):** ask Claude to create a ModuleScript per
  file in `src/shared` under `ReplicatedStorage.WakeShared`, and a Script from
  `src/server/Showcase.server.luau` in `ServerScriptService`, then press Play.

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
every other part is welded to it, so one `PivotTo` moves the whole rider.
The handle has an Attachment named `RopeAttachment` for the live rope.

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
- Oversized gloves and boots, thick baggy legs with a knee bend, a bevelled
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
tests/run.sh /path/to/luau
```

Needs the `luau` CLI from https://github.com/luau-lang/luau/releases. The mock
covers only what RiderBuilder uses; DuskLighting and WaterSpray are checked for
syntax only (`luau-compile --null`) and need a look in Studio.
