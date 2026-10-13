--!strict
--[[
	RiderBuilder

	Builds a chunky, faceted low-poly wakeboard rider from Roblox primitives
	(Block, Wedge, CornerWedge, Ball, Cylinder), SmoothPlastic only. No
	textures, no decals, no faces.

	The faceted look comes from two tricks:
	  1. Every body segment is several overlapping chunks, each rotated a few
	     degrees off its neighbour, so silhouettes break into flat planes.
	  2. Each chunk is a slightly different shade of the same hue
	     (CONFIG.ShadeStep lightness steps), which fakes facet lighting.

	Rider space (before PivotTo): +X is the direction of travel (board nose,
	where the rope pulls from), +Y is up, +Z is the rider's toe side (the way
	the rider faces). Board bottom sits at Y = 0. Units are studs.

	Usage:
		local RiderBuilder = require(path.to.RiderBuilder)
		local rider = RiderBuilder.build({ palette = "A" })
		rider:PivotTo(CFrame.new(0, 0.5, 0))
		rider.Parent = workspace
]]

local RiderBuilder = {}

export type Palette = {
	jacket: Color3, -- main jacket colour (upper body when two-tone)
	jacketLower: Color3?, -- optional lower band of the jacket (two-tone hoodie)
	sleeves: Color3?, -- optional forearm colour; defaults to the jacket
	pants: Color3, -- baggy pants
	gloves: Color3, -- oversized gloves
	boots: Color3, -- chunky boots
	bootSole: Color3, -- boot soles and toe caps
	helmet: Color3, -- helmet or cap shell
	helmetDetail: Color3, -- vents and strap on the helmet
	accent: Color3, -- small details: zip pulls, binding straps, board stripe
	skin: Color3, -- head and neck
	hair: Color3, -- hair tufts and ponytail
	handle: Color3, -- tow handle bar
}

export type Proportions = {
	Scale: number, -- overall size multiplier applied at the end (1 = about 5.5 studs tall)
	HeadSize: number, -- edge length of the head block; small on purpose
	TorsoWidth: number, -- shoulder-to-shoulder width of the jacket
	TorsoDepth: number, -- chest front-to-back depth
	TorsoHeight: number, -- hips to shoulders
	LegThickness: number, -- baggy pant leg thickness at the thigh
	ArmThickness: number, -- puffy sleeve thickness at the shoulder
	HandSize: number, -- glove size; oversized
	BootSize: number, -- boot size multiplier; chunky
	KneeBend: number, -- how far the knees push toward the toes (studs)
	Crouch: number, -- how far the hips drop below standing height (studs)
	TorsoLean: number, -- forward lean toward the toes (degrees)
	TorsoTwist: number, -- chest turned toward the direction of travel (degrees)
	HeadTurn: number, -- head turned further toward travel (degrees)
}

export type Accessories = {
	Helmet: boolean, -- wedge helmet with a front brim
	Hair: boolean, -- tufts under the helmet
	Ponytail: boolean, -- two or three wedges hanging behind the head
	Handle: boolean, -- tow handle in both hands
	Board: boolean, -- wakeboard with bindings
}

export type BoardStyle = {
	deck: Color3, -- top sheet of the board
	rail: Color3, -- darker layer showing along the rails (the sandwich edge)
	base: Color3, -- underside
	baseGraphic: Color3?, -- pale slash graphic on the base, or nil for none
	binding: Color3?, -- binding plate, heel cup and straps, or nil for boots only
	buckle: Color3, -- buckles and D-rings on the bindings
	insert: Color3, -- insert dots and the handle slot on the deck
	stripe: Color3?, -- optional accent stripe down the deck
}

export type BuildOptions = {
	palette: (string | Palette)?, -- name in CONFIG.Palettes or a full palette table
	board: (string | BoardStyle)?, -- name in CONFIG.BoardStyles or a full style table
	proportions: { [string]: number }?, -- overrides for CONFIG.Proportions
	accessories: { [string]: boolean }?, -- overrides for the palette's accessories
	seed: number?, -- facet layout seed; same seed, same rider
	name: string?, -- Model name
}

local rgb = Color3.fromRGB

-- ===================================================================
-- CONFIG: every colour and proportion lives here.
-- ===================================================================
local CONFIG = {
	-- Flat shading everywhere.
	Material = Enum.Material.SmoothPlastic,
	-- Lightness change between neighbouring facet chunks (0.06 = 6 percent).
	ShadeStep = 0.06,
	-- Largest rotation of one chunk off its neighbour, in degrees.
	ChunkTilt = 7,
	-- How much a chunk's size varies around its nominal size (0.12 = +/-12 percent).
	ChunkJitter = 0.12,
	-- Default facet layout seed.
	Seed = 7,

	Palettes = {
		-- Palette A: royal blue jacket, dark purple-grey pants, lime gloves and boots, blue helmet.
		A = {
			colors = {
				jacket = rgb(38, 82, 204), -- royal blue
				pants = rgb(74, 64, 94), -- dark purple-grey
				gloves = rgb(150, 216, 44), -- lime green
				boots = rgb(150, 216, 44), -- lime green
				bootSole = rgb(52, 46, 64), -- dark sole
				helmet = rgb(54, 108, 226), -- lighter blue helmet
				helmetDetail = rgb(28, 40, 96), -- navy vents
				accent = rgb(255, 178, 46), -- warm yellow-orange details
				skin = rgb(236, 182, 140), -- warm skin tone
				hair = rgb(96, 64, 42), -- brown
				handle = rgb(30, 30, 36), -- black handle
			},
			accessories = { Helmet = true, Hair = true, Ponytail = false, Handle = true, Board = true },
		},
		-- Palette B: green jacket, brick red pants, yellow-orange accents, ponytail.
		B = {
			colors = {
				jacket = rgb(52, 152, 86), -- green
				pants = rgb(158, 60, 46), -- brick red
				gloves = rgb(248, 172, 38), -- yellow-orange
				boots = rgb(150, 216, 44), -- lime green
				bootSole = rgb(64, 40, 36), -- dark brown sole
				helmet = rgb(248, 172, 38), -- yellow-orange cap
				helmetDetail = rgb(120, 52, 30), -- burnt orange vents
				accent = rgb(255, 196, 60), -- yellow-orange details
				skin = rgb(228, 168, 126), -- warm skin tone
				hair = rgb(132, 66, 32), -- auburn ponytail
				handle = rgb(30, 30, 36), -- black handle
			},
			accessories = { Helmet = true, Hair = true, Ponytail = true, Handle = true, Board = true },
		},
		-- Palette Sheet: colours from the user's turnaround sheet. Two-tone sage and
		-- navy hoodie, navy cargo pants, red vented helmet, black boots with cream soles.
		Sheet = {
			colors = {
				jacket = rgb(98, 144, 106), -- sage green hoodie top
				jacketLower = rgb(30, 34, 58), -- navy hoodie bottom band
				sleeves = rgb(30, 34, 58), -- navy undershirt sleeves
				pants = rgb(28, 32, 52), -- navy cargo pants
				gloves = rgb(240, 190, 146), -- bare hands (skin)
				boots = rgb(30, 30, 34), -- black boots
				bootSole = rgb(236, 226, 204), -- cream soles
				helmet = rgb(168, 54, 62), -- brick red helmet
				helmetDetail = rgb(40, 30, 34), -- dark vents and centre stripe
				accent = rgb(236, 226, 204), -- cream details (pocket tab, straps)
				skin = rgb(240, 190, 146), -- warm skin tone
				hair = rgb(220, 182, 96), -- blond tufts
				handle = rgb(30, 30, 36), -- black handle
			},
			accessories = { Helmet = true, Hair = true, Ponytail = false, Handle = true, Board = true },
		},
	},

	Proportions = {
		Scale = 1, -- overall size multiplier (Model:ScaleTo after building)
		HeadSize = 0.82, -- small simple head
		TorsoWidth = 1.75, -- puffy jacket width
		TorsoDepth = 1.15, -- jacket depth
		TorsoHeight = 1.45, -- hips to shoulders
		LegThickness = 0.74, -- thick baggy thighs
		ArmThickness = 0.56, -- puffy sleeves
		HandSize = 0.58, -- oversized gloves
		BootSize = 1.0, -- chunky boots
		KneeBend = 0.5, -- visible knee bend toward the toes
		Crouch = 0.15, -- slight athletic crouch
		TorsoLean = 12, -- lean toward the toes, degrees
		TorsoTwist = 22, -- chest turned toward the rope, degrees
		HeadTurn = 35, -- head looking where the rider is going, degrees
	} :: Proportions,

	-- Board shape, shared by every style. Proportions follow the reference
	-- board: long parallel rails, wide rounded-square tips, gentle rocker.
	Board = {
		Length = 4.6, -- tip to tip, measured flat
		Width = 1.36, -- rail to rail
		Thickness = 0.14, -- deck thickness (thin, like a real wakeboard)
		FlatLength = 2.2, -- flat section in the middle, under the bindings
		RockerAngles = { 3, 7, 13 }, -- upturn of each segment from the flat out to a tip, degrees
		TipNarrowing = 0.88, -- width of the last segment relative to the full width
		TipCap = 0.16, -- length of the narrower end cap that rounds each tip
		Stance = 1.9, -- distance between the two bindings
	},

	-- Board colourways. A rider uses CONFIG.DefaultBoard unless BuildOptions.board says otherwise.
	BoardStyles = {
		-- From the user's board reference: sage green, black bindings, copper
		-- buckles, pale slash graphic on the base. Logos and stickers left out.
		Sage = {
			deck = rgb(106, 140, 110), -- sage green top sheet
			rail = rgb(64, 88, 70), -- darker green sandwich edge
			base = rgb(96, 128, 100), -- slightly darker sage underside
			baseGraphic = rgb(206, 216, 198), -- pale grey-green slashes
			binding = rgb(32, 34, 34), -- black bindings
			buckle = rgb(178, 116, 74), -- copper buckles
			insert = rgb(28, 32, 30), -- insert dots and handle slot
			stripe = nil,
		},
		-- The first gray-box board: charcoal with an accent stripe, no bindings.
		Classic = {
			deck = rgb(46, 44, 58), -- charcoal
			rail = rgb(30, 28, 38), -- darker edge
			base = rgb(40, 38, 50), -- underside
			baseGraphic = nil,
			binding = nil,
			buckle = rgb(255, 178, 46), -- yellow-orange
			insert = rgb(24, 22, 30),
			stripe = rgb(255, 178, 46), -- yellow-orange stripe
		},
	},
	DefaultBoard = "Sage",

	Handle = {
		Length = 1.1, -- bar length
		Radius = 0.09, -- bar thickness
		RopeStub = 2.5, -- short length of rope drawn toward the carrier
	},
}

RiderBuilder.Config = CONFIG

-- ===================================================================
-- Helpers
-- ===================================================================

type Ctx = {
	model: Model,
	root: BasePart,
	rng: Random,
	palette: Palette,
	board: BoardStyle,
	p: Proportions,
	acc: Accessories,
}

type Kind = "Block" | "Wedge" | "CornerWedge" | "Ball" | "Cylinder"

local rad = math.rad

--- Shade a colour by `steps` lightness steps (positive is lighter).
local function shade(color: Color3, steps: number): Color3
	local h, s, v = color:ToHSV()
	local nv = math.clamp(v * (1 + steps * CONFIG.ShadeStep), 0, 1)
	-- Darker facets get a touch more saturation, like real shadowed paint.
	local ns = math.clamp(s * (1 - steps * 0.02), 0, 1)
	return Color3.fromHSV(h, ns, nv)
end

local function jitter(ctx: Ctx, amount: number): number
	return ctx.rng:NextNumber(-amount, amount)
end

--- Random small rotation, so each chunk sits a few degrees off its neighbour.
local function tilt(ctx: Ctx, scaleBy: number?): CFrame
	local t = rad(CONFIG.ChunkTilt) * (scaleBy or 1)
	return CFrame.Angles(jitter(ctx, t), jitter(ctx, t), jitter(ctx, t))
end

local function sizeJitter(ctx: Ctx, size: Vector3): Vector3
	local j = CONFIG.ChunkJitter
	return Vector3.new(
		size.X * (1 + jitter(ctx, j)),
		size.Y * (1 + jitter(ctx, j)),
		size.Z * (1 + jitter(ctx, j))
	)
end

--- Create one primitive, welded to the root, in group `group`.
local function prim(ctx: Ctx, group: Instance, kind: Kind, name: string, size: Vector3, cf: CFrame, color: Color3): BasePart
	local part: BasePart
	if kind == "Wedge" then
		part = Instance.new("WedgePart")
	elseif kind == "CornerWedge" then
		part = Instance.new("CornerWedgePart")
	else
		local p = Instance.new("Part")
		if kind == "Ball" then
			p.Shape = Enum.PartType.Ball
		elseif kind == "Cylinder" then
			p.Shape = Enum.PartType.Cylinder
		else
			p.Shape = Enum.PartType.Block
		end
		part = p
	end
	part.Name = name
	part.Size = size
	part.CFrame = cf
	part.Color = color
	part.Material = CONFIG.Material
	part.TopSurface = Enum.SurfaceType.Smooth
	part.BottomSurface = Enum.SurfaceType.Smooth
	part.CastShadow = true
	part.CanCollide = false
	part.CanQuery = false
	part.CanTouch = false
	part.Massless = true
	part.Anchored = false
	part.Parent = group
	local weld = Instance.new("WeldConstraint")
	weld.Part0 = ctx.root
	weld.Part1 = part
	weld.Parent = part
	return part
end

local function newGroup(ctx: Ctx, name: string): Model
	local g = Instance.new("Model")
	g.Name = name
	g.Parent = ctx.model
	return g
end

--- A CFrame at `from` whose -Z axis points at `to`, with a safe up vector.
local function along(from: Vector3, to: Vector3): CFrame
	local dir = to - from
	local up = if math.abs(dir.Unit.Y) > 0.9 then Vector3.new(0, 0, 1) else Vector3.new(0, 1, 0)
	return CFrame.lookAt(from, to, up)
end

--[[
	A limb from `a` to `b` built from `n` overlapping chunks. Thickness
	tapers from `thickA` to `thickB`. Every other chunk gets an extra wedge
	facet on its outer face, so the sleeve or pant leg reads as puffy and
	angular instead of a tube.
]]
local function limb(ctx: Ctx, group: Instance, name: string, a: Vector3, b: Vector3, thickA: number, thickB: number, color: Color3, n: number)
	local base = along(a, b)
	local len = (b - a).Magnitude
	for i = 0, n - 1 do
		local t = (i + 0.5) / n
		local th = thickA + (thickB - thickA) * t
		local cf = base * CFrame.new(jitter(ctx, th * 0.06), jitter(ctx, th * 0.06), -len * t) * tilt(ctx)
		local size = sizeJitter(ctx, Vector3.new(th, th, len / n * 1.45))
		local steps = ((i % 3) - 1) + jitter(ctx, 0.4)
		prim(ctx, group, "Block", `{name}{i}`, size, cf, shade(color, steps))
		if i % 2 == 0 then
			-- Outer facet: a thin wedge laid on one side, rotated to a random side.
			local side = ctx.rng:NextInteger(0, 3) * 90
			local facet = cf * CFrame.Angles(0, 0, rad(side)) * CFrame.new(0, th * 0.4, 0) * tilt(ctx, 0.35)
			prim(ctx, group, "Wedge", `{name}{i}Facet`, Vector3.new(th * 0.82, th * 0.16, len / n * 1.0), facet, shade(color, steps + 1))
		end
	end
end

--- Oversized glove: a palm block, a thumb wedge and a knuckle ball.
local function glove(ctx: Ctx, group: Instance, name: string, at: Vector3, facing: Vector3, color: Color3)
	local s = ctx.p.HandSize
	local cf = CFrame.lookAt(at, at + facing) * tilt(ctx)
	prim(ctx, group, "Block", `{name}Palm`, Vector3.new(s, s * 0.8, s * 0.9), cf, shade(color, 0))
	prim(ctx, group, "Wedge", `{name}Thumb`, Vector3.new(s * 0.45, s * 0.4, s * 0.55), cf * CFrame.new(s * 0.45, s * 0.1, 0) * tilt(ctx), shade(color, 1))
	prim(ctx, group, "Ball", `{name}Knuckles`, Vector3.new(s * 0.8, s * 0.8, s * 0.8), cf * CFrame.new(0, s * 0.15, -s * 0.3), shade(color, -1))
	prim(ctx, group, "Block", `{name}Cuff`, Vector3.new(s * 0.95, s * 0.5, s * 0.5), cf * CFrame.new(0, 0, s * 0.55) * tilt(ctx), shade(color, -2))
end

-- ===================================================================
-- Body parts
-- ===================================================================

--[[
	Board: a flat middle section, then on each side a chain of segments, each
	turned up a little more (CONFIG.Board.RockerAngles), so the rocker reads as
	a gentle faceted curve in side view. Each segment is a deck block over a
	slightly wider, darker rail layer. Tips are narrowed and their corners
	chamfered with 45-degree blocks into a rounded-square outline.
]]
local function buildBoard(ctx: Ctx): Vector3
	local bc = CONFIG.Board
	local st = ctx.board
	local g = newGroup(ctx, "Board")
	local t = bc.Thickness
	local w = bc.Width
	local railT = t * 0.45

	local function slab(name: string, len: number, width: number, cf: CFrame, steps: number)
		prim(ctx, g, "Block", `{name}Deck`, Vector3.new(len, t * 0.6, width * 0.97), cf * CFrame.new(0, t * 0.2, 0), shade(st.deck, steps))
		prim(ctx, g, "Block", `{name}Rail`, Vector3.new(len, railT, width), cf * CFrame.new(0, -t * 0.25, 0), shade(st.rail, steps * 0.5))
	end

	-- Flat middle.
	local half = bc.FlatLength / 2
	slab("Mid", bc.FlatLength, w, CFrame.new(0, t / 2, 0), 0)
	-- Base underside and its graphic.
	prim(ctx, g, "Block", "Base", Vector3.new(bc.FlatLength, 0.02, w * 0.94), CFrame.new(0, 0.005, 0), st.base)
	if st.baseGraphic then
		-- Four pale slashes in a loose zig-zag, laid just under the base.
		local slashes = {
			{ x = -0.55, z = 0.12, len = 1.25, ang = 52 },
			{ x = 0.1, z = -0.05, len = 1.5, ang = 58 },
			{ x = 0.62, z = 0.18, len = 0.8, ang = 48 },
			{ x = -0.15, z = 0.32, len = 0.5, ang = 64 },
		}
		for i, sl in slashes do
			local cf = CFrame.new(sl.x, -0.012, sl.z) * CFrame.Angles(0, rad(sl.ang), 0)
			prim(ctx, g, "Block", `BaseSlash{i}`, Vector3.new(sl.len, 0.02, 0.09 + 0.03 * (i % 2)), cf, st.baseGraphic)
		end
	end

	-- Rocker segments out to each tip.
	local n = #bc.RockerAngles
	local segLen = (bc.Length / 2 - half) / n
	for _, dir in { -1, 1 } do
		local hinge = CFrame.new(dir * half, t / 2, 0)
		local endWidth = w
		for i, deg in bc.RockerAngles do
			local width = w * (1 - (1 - bc.TipNarrowing) * (i / n))
			-- Turn about the segment's inner edge, then step out to its centre.
			local turned = hinge * CFrame.Angles(0, 0, dir * rad(deg - (bc.RockerAngles[i - 1] or 0)))
			local centre = turned * CFrame.new(dir * segLen / 2, 0, 0)
			slab(`Tip{dir}_{i}`, segLen * 1.04, width, centre, -0.5 * i)
			hinge = turned * CFrame.new(dir * segLen, 0, 0)
			endWidth = width
		end
		-- Rounded-square tip: a narrower end cap steps the outline in, so the
		-- nose and tail read as rounded rather than square.
		local cap = hinge * CFrame.Angles(0, 0, dir * rad(3)) * CFrame.new(dir * bc.TipCap / 2, 0, 0)
		slab(`TipCap{dir}`, bc.TipCap * 1.1, endWidth * 0.8, cap, -2)
		-- Fin under the tip, near the end of the flat.
		prim(ctx, g, "Wedge", `Fin{dir}`, Vector3.new(0.05, 0.18, 0.32), CFrame.new(dir * (half + 0.15), -0.09, 0) * CFrame.Angles(0, if dir > 0 then math.pi / 2 else -math.pi / 2, 0), shade(st.rail, -1))
	end

	-- Deck details: insert dots beside each binding and a handle slot at the tail.
	local deckTop = t * 0.5 + t * 0.2
	local stance = bc.Stance / 2
	for _, x in { -stance, stance } do
		for _, z in { -0.42, 0.42 } do
			prim(ctx, g, "Block", `Insert{x}{z}`, Vector3.new(0.07, 0.02, 0.07), CFrame.new(x + 0.48, deckTop + 0.01, z * w * 0.5), st.insert)
		end
	end
	prim(ctx, g, "Block", "HandleSlot", Vector3.new(0.1, 0.02, 0.32), CFrame.new(-half - 0.05, deckTop + 0.01, 0), st.insert)
	if st.stripe then
		prim(ctx, g, "Block", "Stripe", Vector3.new(bc.FlatLength * 0.9, 0.02, 0.22), CFrame.new(0, deckTop + 0.01, -w * 0.22), st.stripe)
	end
	return Vector3.new(0, deckTop, 0)
end

--- Chunky boot with sole, toe cap and binding strap. Returns the top of the boot.
local function buildBoot(ctx: Ctx, g: Instance, name: string, x: number, deckTop: number): Vector3
	local pal = ctx.palette
	local s = ctx.p.BootSize
	local len, wid, hgt = 1.35 * s, 0.82 * s, 0.72 * s
	local st = ctx.board
	local plate = if st.binding then 0.08 * s else 0
	if st.binding then
		-- Binding plate: wider and longer than the boot.
		local pcf = CFrame.new(x, deckTop + plate / 2, 0.02)
		prim(ctx, g, "Block", `{name}Plate`, Vector3.new(wid * 1.3, plate, len * 1.12), pcf, st.binding)
		-- Heel cup wrapping the back of the boot.
		prim(ctx, g, "Block", `{name}HeelCup`, Vector3.new(wid * 1.14, hgt * 0.62, 0.2 * s), CFrame.new(x, deckTop + plate + hgt * 0.31, -len * 0.48) * tilt(ctx, 0.4), shade(st.binding, 0.5))
		-- Side walls up each side of the boot.
		for _, side in { -1, 1 } do
			prim(ctx, g, "Block", `{name}Wall{side}`, Vector3.new(0.1 * s, hgt * 0.42, len * 0.7), CFrame.new(x + side * wid * 0.55, deckTop + plate + hgt * 0.21, -0.08) * tilt(ctx, 0.3), shade(st.binding, side * 0.5))
		end
		-- Buckle and D-ring on the outside wall, in copper.
		local outer = if x >= 0 then 1 else -1
		prim(ctx, g, "Block", `{name}Buckle`, Vector3.new(0.06 * s, 0.2 * s, 0.14 * s), CFrame.new(x + outer * wid * 0.63, deckTop + plate + hgt * 0.24, -len * 0.18), st.buckle)
		prim(ctx, g, "Block", `{name}DRing`, Vector3.new(0.05 * s, 0.14 * s, 0.05 * s), CFrame.new(x + outer * wid * 0.63, deckTop + plate + hgt * 0.62, len * 0.12) * CFrame.Angles(rad(30), 0, 0), st.buckle)
	end
	local base = CFrame.new(x, deckTop + plate, 0)
	prim(ctx, g, "Block", `{name}Sole`, Vector3.new(wid * 1.06, 0.16 * s, len * 1.04), base * CFrame.new(0, 0.08 * s, 0.05), pal.bootSole)
	prim(ctx, g, "Block", `{name}Body`, Vector3.new(wid, hgt * 0.7, len * 0.9), base * CFrame.new(0, 0.16 * s + hgt * 0.35, -0.02) * tilt(ctx, 0.5), shade(pal.boots, 0))
	prim(ctx, g, "Block", `{name}Shaft`, Vector3.new(wid * 0.92, hgt * 0.55, len * 0.55), base * CFrame.new(0, 0.16 * s + hgt * 0.8, -len * 0.18) * tilt(ctx, 0.5), shade(pal.boots, 1))
	-- Toe cap: wedge sloping down toward the toes (+Z).
	prim(ctx, g, "Wedge", `{name}Toe`, Vector3.new(wid * 0.98, hgt * 0.45, len * 0.38), base * CFrame.new(0, 0.16 * s + hgt * 0.62, len * 0.3) * CFrame.Angles(0, math.pi, 0), shade(pal.boots, -1))
	prim(ctx, g, "Block", `{name}ToeBumper`, Vector3.new(wid * 1.02, 0.2 * s, 0.22 * s), base * CFrame.new(0, 0.22 * s, len * 0.48), pal.bootSole)
	-- Binding strap across the instep, and an ankle strap when there is a binding.
	local strapColor = st.binding or pal.accent
	prim(ctx, g, "Block", `{name}Strap`, Vector3.new(wid * 1.16, 0.14 * s, 0.32 * s), base * CFrame.new(0, 0.16 * s + hgt * 0.62, len * 0.05) * tilt(ctx, 0.4), strapColor)
	if st.binding then
		prim(ctx, g, "Block", `{name}AnkleStrap`, Vector3.new(wid * 1.1, 0.14 * s, 0.3 * s), base * CFrame.new(0, 0.16 * s + hgt * 0.92, -len * 0.2) * tilt(ctx, 0.4), shade(st.binding, 1))
		prim(ctx, g, "Block", `{name}StrapTab`, Vector3.new(0.12 * s, 0.1 * s, 0.1 * s), base * CFrame.new(wid * 0.2, 0.16 * s + hgt * 0.7, len * 0.12), st.buckle)
	end
	return Vector3.new(x, deckTop + plate + 0.16 * s + hgt * 1.0, -len * 0.12)
end

local function buildLegs(ctx: Ctx, deckTop: number): (Vector3, Vector3)
	local p = ctx.p
	local pal = ctx.palette
	local g = newGroup(ctx, "Legs")
	local stance = CONFIG.Board.Stance / 2
	local plate = if ctx.board.binding then 0.08 * p.BootSize else 0
	local hipY = deckTop + plate + 0.88 * p.BootSize + 1.95 - p.Crouch
	local hips = {}
	for _, dir in { 1, -1 } do
		local name = if dir > 0 then "Front" else "Back"
		local ankle = buildBoot(ctx, g, `{name}Boot`, dir * stance, deckTop)
		local hip = Vector3.new(dir * 0.52, hipY, -0.08)
		local mid = (ankle + hip) / 2
		local knee = Vector3.new(mid.X * 1.08, mid.Y - 0.05, mid.Z + p.KneeBend)
		local th = p.LegThickness
		limb(ctx, g, `{name}Shin`, ankle + Vector3.new(0, -0.1, 0), knee, th * 0.98, th * 0.9, pal.pants, 3)
		limb(ctx, g, `{name}Thigh`, knee, hip, th * 0.92, th, pal.pants, 3)
		-- Knee chunk so the bend reads clearly.
		prim(ctx, g, "Block", `{name}Knee`, Vector3.new(th * 1.02, th * 0.9, th * 0.95), CFrame.new(knee) * tilt(ctx, 1.5), shade(pal.pants, 1))
		-- Baggy cuff over the boot.
		prim(ctx, g, "Block", `{name}Cuff`, Vector3.new(th * 1.12, th * 0.5, th * 1.15), CFrame.new(ankle + Vector3.new(0, 0.05, 0.05)) * tilt(ctx), shade(pal.pants, -1))
		-- Cargo pocket on the outside of the thigh.
		local thighMid = (knee + hip) / 2
		prim(ctx, g, "Block", `{name}Pocket`, Vector3.new(0.12, th * 0.55, th * 0.5), CFrame.new(thighMid + Vector3.new(dir * th * 0.52, -0.05, 0.05)) * tilt(ctx, 0.5), shade(pal.pants, 1.5))
		table.insert(hips, hip)
	end
	return hips[1], hips[2]
end

--- Puffy torso. Returns the torso CFrame (origin at hip centre, +Y up the spine).
local function buildTorso(ctx: Ctx, hipCentre: Vector3): CFrame
	local p = ctx.p
	local pal = ctx.palette
	local g = newGroup(ctx, "Torso")
	local w, h, d = p.TorsoWidth, p.TorsoHeight, p.TorsoDepth
	local torso = CFrame.new(hipCentre) * CFrame.Angles(0, rad(p.TorsoTwist), 0) * CFrame.Angles(rad(p.TorsoLean), 0, 0)
	local lower = pal.jacketLower or pal.jacket

	-- Pant waist under the jacket hem.
	prim(ctx, g, "Block", "Waist", Vector3.new(w * 0.78, 0.35, d * 0.85), torso * CFrame.new(0, 0.05, 0), shade(pal.pants, 0))

	-- 2 rows x 3 columns of overlapping jacket chunks.
	for row = 0, 1 do
		for col = -1, 1 do
			local color = if row == 0 then lower else pal.jacket
			local cx = col * w * 0.3
			local cy = 0.32 + row * h * 0.42 + h * 0.18
			local size = sizeJitter(ctx, Vector3.new(w * 0.44, h * 0.5, d * (if col == 0 then 1.0 else 0.9)))
			local cf = torso * CFrame.new(cx, cy, jitter(ctx, 0.05)) * tilt(ctx)
			prim(ctx, g, "Block", `Jacket{row}{col}`, size, cf, shade(color, col + row * 0.5 + jitter(ctx, 0.4)))
		end
	end
	-- Chest facets: wedges on the front so the chest catches light as planes.
	for _, side in { -1, 1 } do
		local cf = torso * CFrame.new(side * w * 0.2, 0.32 + h * 0.62, d * 0.5) * CFrame.Angles(0, math.pi, 0) * tilt(ctx, 0.7)
		prim(ctx, g, "Wedge", `Chest{side}`, Vector3.new(w * 0.42, h * 0.3, d * 0.22), cf, shade(pal.jacket, 1.5))
	end
	-- Hem band.
	prim(ctx, g, "Block", "Hem", Vector3.new(w * 1.02, 0.2, d * 1.05), torso * CFrame.new(0, 0.3, 0) * tilt(ctx, 0.4), shade(lower, -1.5))
	-- Shoulder pads: wedges sloping down and outward, rounding the top corners.
	-- A wedge slopes toward its -Z face; turning it 90 degrees about Y points that outward.
	for _, side in { -1, 1 } do
		local cf = torso * CFrame.new(side * w * 0.36, 0.32 + h * 0.97, 0) * CFrame.Angles(0, if side > 0 then -math.pi / 2 else math.pi / 2, 0) * tilt(ctx, 0.5)
		prim(ctx, g, "Wedge", `Shoulder{side}`, Vector3.new(d * 0.92, h * 0.2, w * 0.34), cf, shade(pal.jacket, 0.5))
	end
	-- Hood / collar behind the neck.
	prim(ctx, g, "Block", "Collar", Vector3.new(w * 0.5, 0.28, d * 0.6), torso * CFrame.new(0, 0.32 + h * 1.0, -d * 0.12) * tilt(ctx, 0.5), shade(pal.jacket, -1))
	prim(ctx, g, "Wedge", "Hood", Vector3.new(w * 0.55, h * 0.32, d * 0.4), torso * CFrame.new(0, 0.32 + h * 0.9, -d * 0.55) * tilt(ctx, 0.5), shade(pal.jacket, -1.5))
	-- Zip pull / drawstring details in the accent colour.
	prim(ctx, g, "Block", "ZipPull", Vector3.new(0.08, 0.28, 0.06), torso * CFrame.new(w * 0.08, 0.32 + h * 0.78, d * 0.56), pal.accent)
	prim(ctx, g, "Block", "Logo", Vector3.new(0.3, 0.08, 0.04), torso * CFrame.new(-w * 0.22, 0.32 + h * 0.74, d * 0.55), pal.accent)
	return torso
end

local function buildHead(ctx: Ctx, torso: CFrame)
	local p = ctx.p
	local pal = ctx.palette
	local g = newGroup(ctx, "Head")
	local hs = p.HeadSize
	local neckTop = torso * CFrame.new(0, 0.32 + p.TorsoHeight + 0.12, 0.04)
	prim(ctx, g, "Block", "Neck", Vector3.new(hs * 0.42, 0.3, hs * 0.42), neckTop, shade(pal.skin, -1.5))
	local head = neckTop * CFrame.new(0, 0.1 + hs * 0.5, 0) * CFrame.Angles(0, rad(p.HeadTurn), 0) * CFrame.Angles(rad(-p.TorsoLean * 0.6), 0, 0)
	prim(ctx, g, "Block", "Skull", Vector3.new(hs, hs, hs), head, pal.skin)
	-- Face plane: one wedge on the front, its slope facing up and forward so it
	-- catches the light like a cheek plane. No eyes, nose or mouth.
	prim(ctx, g, "Wedge", "Face", Vector3.new(hs * 0.84, hs * 0.5, hs * 0.18), head * CFrame.new(0, -hs * 0.2, hs * 0.55) * CFrame.Angles(0, math.pi, 0), shade(pal.skin, 1.5))

	if ctx.acc.Hair then
		-- Back: a slab under the helmet band, with a wedge flicking out at the nape.
		prim(ctx, g, "Block", "HairBack", Vector3.new(hs * 1.06, hs * 0.42, hs * 0.16), head * CFrame.new(0, hs * 0.12, -hs * 0.5) * tilt(ctx, 0.5), shade(pal.hair, 0))
		prim(ctx, g, "Wedge", "HairNape", Vector3.new(hs * 0.9, hs * 0.22, hs * 0.22), head * CFrame.new(0, -hs * 0.12, -hs * 0.58) * tilt(ctx, 0.8), shade(pal.hair, -1))
		-- Sides: tufts over the ears, sloping down and out.
		for _, side in { -1, 1 } do
			local cf = head * CFrame.new(side * hs * 0.55, hs * 0.1, -hs * 0.1) * CFrame.Angles(0, if side > 0 then -math.pi / 2 else math.pi / 2, 0) * tilt(ctx, 0.8)
			prim(ctx, g, "Wedge", `HairSide{side}`, Vector3.new(hs * 0.7, hs * 0.38, hs * 0.14), cf, shade(pal.hair, 0.5 * side))
		end
		-- Fringe: a thin strip just under the brim, above where the face plane starts.
		prim(ctx, g, "Wedge", "HairFringe", Vector3.new(hs * 0.9, hs * 0.14, hs * 0.12), head * CFrame.new(-hs * 0.05, hs * 0.22, hs * 0.52) * CFrame.Angles(0, math.pi, 0) * tilt(ctx, 0.5), shade(pal.hair, 1))
	end

	if ctx.acc.Ponytail then
		local anchor = head * CFrame.new(0, hs * 0.2, -hs * 0.55)
		for i = 1, 3 do
			local cf = anchor * CFrame.new(0, -hs * 0.3 * (i - 1), -hs * 0.12 * i) * CFrame.Angles(rad(-20 - 12 * i), 0, 0) * tilt(ctx, 0.8)
			local s = 1 - (i - 1) * 0.22
			prim(ctx, g, "Wedge", `Ponytail{i}`, Vector3.new(hs * 0.36 * s, hs * 0.5, hs * 0.32 * s), cf, shade(pal.hair, 1 - i))
		end
		prim(ctx, g, "Block", "HairTie", Vector3.new(hs * 0.24, hs * 0.12, hs * 0.2), anchor * CFrame.new(0, -hs * 0.02, -hs * 0.06), pal.accent)
	end

	if ctx.acc.Helmet then
		local shell = head * CFrame.new(0, hs * 0.42, -hs * 0.02)
		local hw = hs * 1.16
		prim(ctx, g, "Block", "HelmetBand", Vector3.new(hw, hs * 0.32, hw), shell, shade(pal.helmet, 0))
		prim(ctx, g, "Block", "HelmetCrown", Vector3.new(hw * 0.62, hs * 0.26, hw * 0.62), shell * CFrame.new(0, hs * 0.29, 0) * tilt(ctx, 0.4), shade(pal.helmet, 1))
		-- Four sloping wedges make the dome facets.
		for k = 0, 3 do
			local cf = shell * CFrame.Angles(0, rad(90 * k), 0) * CFrame.new(0, hs * 0.29, hw * 0.4) * CFrame.Angles(0, math.pi, 0)
			prim(ctx, g, "Wedge", `HelmetDome{k}`, Vector3.new(hw * 0.62, hs * 0.26, hw * 0.2), cf, shade(pal.helmet, if k % 2 == 0 then 0.5 else -0.5))
		end
		-- A second band turned 45 degrees fills the corners, so the shell reads as an octagon.
		prim(ctx, g, "Block", "HelmetBand45", Vector3.new(hw * 0.9, hs * 0.3, hw * 0.9), shell * CFrame.new(0, hs * 0.04, 0) * CFrame.Angles(0, rad(45), 0), shade(pal.helmet, -0.5))
		prim(ctx, g, "Block", "HelmetDome45", Vector3.new(hw * 0.55, hs * 0.24, hw * 0.55), shell * CFrame.new(0, hs * 0.27, 0) * CFrame.Angles(0, rad(45), 0), shade(pal.helmet, 0.5))
		-- Front brim.
		prim(ctx, g, "Wedge", "Brim", Vector3.new(hw * 0.86, hs * 0.1, hs * 0.36), shell * CFrame.new(0, -hs * 0.1, hw * 0.6) * CFrame.Angles(math.pi, 0, 0) * CFrame.Angles(rad(-8), 0, 0), shade(pal.helmet, -1))
		-- Vents and centre stripe.
		prim(ctx, g, "Block", "HelmetStripe", Vector3.new(hw * 0.14, 0.04, hw * 0.66), shell * CFrame.new(0, hs * 0.43, 0), pal.helmetDetail)
		for k, x in { -0.28, 0.28 } do
			prim(ctx, g, "Block", `HelmetVent{k}`, Vector3.new(hw * 0.14, 0.05, hw * 0.2), shell * CFrame.new(x * hw, hs * 0.43, hw * 0.12), pal.helmetDetail)
		end
	end
end

local function buildArmsAndHandle(ctx: Ctx, torso: CFrame, hipCentre: Vector3)
	local p = ctx.p
	local pal = ctx.palette
	local g = newGroup(ctx, "Arms")
	local hc = CONFIG.Handle
	local w, h = p.TorsoWidth, p.TorsoHeight
	-- Handle low in front of the lead hip, bar across the body.
	local gripFront = hipCentre + Vector3.new(0.95, -0.12, 0.42)
	local gripBack = gripFront + Vector3.new(-0.55, 0, 0.95).Unit * hc.Length * 0.8
	local sleeves = pal.sleeves or pal.jacket
	for _, side in { 1, -1 } do
		local name = if side > 0 then "Front" else "Back"
		local shoulder = (torso * CFrame.new(side * w * 0.48, 0.32 + h * 0.86, 0)).Position
		local grip = if side > 0 then gripFront else gripBack
		local mid = (shoulder + grip) / 2
		local elbow = mid + Vector3.new(side * 0.15, -0.18, 0.12)
		limb(ctx, g, `{name}UpperArm`, shoulder, elbow, p.ArmThickness, p.ArmThickness * 0.92, pal.jacket, 2)
		limb(ctx, g, `{name}Forearm`, elbow, grip, p.ArmThickness * 0.88, p.ArmThickness * 0.8, sleeves, 2)
		glove(ctx, g, `{name}Glove`, grip, (grip - elbow).Unit, pal.gloves)
	end
	if ctx.acc.Handle then
		local hg = newGroup(ctx, "Handle")
		local centre = (gripFront + gripBack) / 2
		local barDir = (gripBack - gripFront).Unit
		-- Cylinder's long axis is X, so turn X onto the bar direction.
		local bar = CFrame.lookAt(centre, centre + barDir) * CFrame.Angles(0, math.pi / 2, 0)
		local barPart = prim(ctx, hg, "Cylinder", "Bar", Vector3.new(hc.Length, hc.Radius * 2, hc.Radius * 2), bar, pal.handle)
		for k, sgn in { -1, 1 } do
			prim(ctx, hg, "Cylinder", `EndCap{k}`, Vector3.new(0.08, hc.Radius * 2.6, hc.Radius * 2.6), bar * CFrame.new(sgn * hc.Length / 2, 0, 0), pal.accent)
		end
		-- Short rope stub toward the carrier (+X). The game replaces this with the live rope.
		local ropeStart = centre + Vector3.new(0.1, 0, 0)
		local ropeEnd = ropeStart + Vector3.new(hc.RopeStub, 0.6, -0.2)
		local ropeCf = CFrame.lookAt((ropeStart + ropeEnd) / 2, ropeEnd) * CFrame.Angles(0, math.pi / 2, 0)
		prim(ctx, hg, "Cylinder", "RopeStub", Vector3.new((ropeEnd - ropeStart).Magnitude, 0.05, 0.05), ropeCf, pal.handle)
		local att = Instance.new("Attachment")
		att.Name = "RopeAttachment"
		att.Parent = barPart
		att.WorldPosition = ropeStart
	end
end

-- ===================================================================
-- Public API
-- ===================================================================

local function resolvePalette(spec: (string | Palette)?): (Palette, Accessories)
	if spec == nil or type(spec) == "string" then
		local key = (spec :: string?) or "A"
		local entry = CONFIG.Palettes[key]
		assert(entry, `Unknown rider palette "{key}"`)
		return entry.colors :: Palette, table.clone(entry.accessories) :: Accessories
	end
	return spec :: Palette, { Helmet = true, Hair = true, Ponytail = false, Handle = true, Board = true }
end

--[[
	Build a rider Model. The Model is not parented; set Parent yourself.
	PrimaryPart is "Root", an invisible anchored block at the centre of the
	board base. Every other part is welded to Root, so moving the rider is
	one PivotTo call. The tow handle carries an Attachment "RopeAttachment".
]]
function RiderBuilder.build(options: BuildOptions?): Model
	local opts = options or {}
	local palette, accessories = resolvePalette(opts.palette)
	local accTable = accessories :: any
	for k, v in (opts.accessories or {}) :: { [string]: boolean } do
		accTable[k] = v
	end
	local proportions = table.clone(CONFIG.Proportions) :: any
	for k, v in (opts.proportions or {}) :: { [string]: number } do
		proportions[k] = v
	end

	local model = Instance.new("Model")
	model.Name = opts.name or "WakeRider"
	local root = Instance.new("Part")
	root.Name = "Root"
	root.Size = Vector3.new(0.5, 0.5, 0.5)
	root.CFrame = CFrame.new(0, 0.25, 0)
	root.Transparency = 1
	root.Anchored = true
	root.CanCollide = false
	root.CanQuery = false
	root.CanTouch = false
	root.Material = CONFIG.Material
	root.Parent = model
	model.PrimaryPart = root

	local boardSpec = opts.board or CONFIG.DefaultBoard
	local boardStyle: BoardStyle
	if type(boardSpec) == "string" then
		local found = (CONFIG.BoardStyles :: any)[boardSpec]
		assert(found, `Unknown board style "{boardSpec}"`)
		boardStyle = found
	else
		boardStyle = boardSpec :: BoardStyle
	end

	local ctx: Ctx = {
		model = model,
		root = root,
		rng = Random.new(opts.seed or CONFIG.Seed),
		palette = palette,
		board = boardStyle,
		p = proportions :: Proportions,
		acc = accessories,
	}

	local deckTop = if accessories.Board then buildBoard(ctx).Y else 0
	local hipFront, hipBack = buildLegs(ctx, deckTop)
	local hipCentre = (hipFront + hipBack) / 2
	local torso = buildTorso(ctx, hipCentre)
	buildHead(ctx, torso)
	buildArmsAndHandle(ctx, torso, hipCentre)

	if proportions.Scale ~= 1 then
		model:ScaleTo(proportions.Scale)
	end
	return model
end

--- Names of the built-in palettes, for menus and tests.
function RiderBuilder.paletteNames(): { string }
	local names = {}
	for name in CONFIG.Palettes do
		table.insert(names, name)
	end
	table.sort(names)
	return names
end

return RiderBuilder
