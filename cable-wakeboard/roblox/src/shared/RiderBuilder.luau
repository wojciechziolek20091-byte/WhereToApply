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

	The rider is a jointed rig for the animation system (shared/Anim): one
	invisible bone part per joint ("Bone<Joint>"), each turned by a Motor6D
	named after the joint (Hips, Waist, Neck, LShoulder, LElbow, LWrist, ...;
	L is the lead side, +X). Every visual part is welded to its bone, so the
	art is unchanged and Motor6D.Transform poses it. The rest pose is neutral
	and mirror-symmetric (upright, arms hanging in front); bone rest
	orientations are identity, so a joint's Transform is the animator's local
	rotation. The tow handle is its own Model ("Handle") that the client moves.

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
	ChunkTilt = 3,
	-- How much a chunk's size varies around its nominal size (0.05 = +/-5 percent).
	ChunkJitter = 0.05,
	-- Torso cross-sections from the hips up: height fraction, width fraction, depth fraction.
	-- Narrow at the waist, widest across the chest, so the jacket reads as a shaped body.
	TorsoSections = {
		{ h = 0.16, w = 0.66, d = 0.92 }, -- hips
		{ h = 0.2, w = 0.6, d = 0.86 }, -- waist
		{ h = 0.22, w = 0.78, d = 0.94 }, -- lower ribs
		{ h = 0.26, w = 0.94, d = 1.0 }, -- chest
		{ h = 0.16, w = 0.86, d = 0.86 }, -- upper chest, under the shoulders
	},
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
		HeadSize = 0.74, -- small simple head
		TorsoWidth = 1.22, -- shoulder width; the waist tapers in from here
		TorsoDepth = 0.72, -- chest front-to-back depth
		TorsoHeight = 1.6, -- hips to shoulders
		LegThickness = 0.44, -- pant leg thickness at the thigh
		ArmThickness = 0.3, -- sleeve thickness at the shoulder
		HandSize = 0.36, -- glove size, still a little oversized
		BootSize = 0.82, -- boot size multiplier
		KneeBend = 0.55, -- visible knee bend toward the toes
		Crouch = 0.15, -- slight athletic crouch
		-- Rest-pose posture. Keep these 0 for an animated rig: the animator sets the
		-- lean, twist and head turn, and needs a mirror-symmetric rest pose.
		TorsoLean = 0, -- lean toward the toes, degrees
		TorsoTwist = 0, -- chest turned toward the rope, degrees
		HeadTurn = 0, -- head looking where the rider is going, degrees
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
		GripSpacing = 0.55, -- distance between the two hands on the bar
	},

	Rig = {
		-- Rest-pose fists, from the hip centre (mirrored for the back hand): in front of the hips.
		RestGrip = Vector3.new(0.62, 0.1, 1.0),
		-- Metres per stud, for the animator's RigDef (the sim and animator work in metres).
		MetresPerStud = 0.28,
	},
}

RiderBuilder.Config = CONFIG

-- ===================================================================
-- Helpers
-- ===================================================================

type Ctx = {
	model: Model,
	root: BasePart,
	bone: BasePart?, -- parts are welded to this bone (Root when nil)
	bones: { [string]: BasePart },
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
	weld.Part0 = ctx.bone or ctx.root
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
	tapers from `thickA` to `thickB`. Each chunk is a block plus a copy turned
	45 degrees about the limb axis, so the cross-section is an octagon: it
	reads as a shaped, faceted limb rather than a square post. Neighbouring
	chunks are tilted a few degrees and shaded a step apart.
]]
local function limb(ctx: Ctx, group: Instance, name: string, a: Vector3, b: Vector3, thickA: number, thickB: number, color: Color3, n: number)
	local base = along(a, b)
	local len = (b - a).Magnitude
	for i = 0, n - 1 do
		local t = (i + 0.5) / n
		local th = thickA + (thickB - thickA) * t
		local cf = base * CFrame.new(0, 0, -len * t) * tilt(ctx)
		local chunkLen = len / n * 1.25
		local steps = ((i % 3) - 1) * 0.8 + jitter(ctx, 0.3)
		prim(ctx, group, "Block", `{name}{i}`, sizeJitter(ctx, Vector3.new(th, th, chunkLen)), cf, shade(color, steps))
		prim(ctx, group, "Block", `{name}{i}Bevel`, Vector3.new(th * 0.94, th * 0.94, chunkLen * 0.98), cf * CFrame.Angles(0, 0, rad(45)), shade(color, steps + 0.8))
	end
end

--- A rounded joint (shoulder, elbow, knee): a faceted ball.
local function joint(ctx: Ctx, group: Instance, name: string, at: Vector3, size: number, color: Color3)
	prim(ctx, group, "Ball", name, Vector3.new(size, size, size), CFrame.new(at) * tilt(ctx, 3), color)
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
local function buildBoot(ctx: Ctx, g: Instance, name: string, x: number, deckTop: number, ankleBone: string): Vector3
	local pal = ctx.palette
	-- Binding hardware stays on the board (Root); the boot moves with the foot.
	ctx.bone = ctx.root
	local s = ctx.p.BootSize
	local len, wid, hgt = 1.3 * s, 0.7 * s, 0.64 * s
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
	ctx.bone = ctx.bones[ankleBone]
	prim(ctx, g, "Block", `{name}Sole`, Vector3.new(wid * 1.06, 0.16 * s, len * 1.04), base * CFrame.new(0, 0.08 * s, 0.05), pal.bootSole)
	prim(ctx, g, "Block", `{name}Body`, Vector3.new(wid, hgt * 0.7, len * 0.9), base * CFrame.new(0, 0.16 * s + hgt * 0.35, -0.02) * tilt(ctx, 0.5), shade(pal.boots, 0))
	prim(ctx, g, "Block", `{name}Shaft`, Vector3.new(wid * 0.92, hgt * 0.55, len * 0.55), base * CFrame.new(0, 0.16 * s + hgt * 0.8, -len * 0.18) * tilt(ctx, 0.5), shade(pal.boots, 1))
	-- Toe cap: wedge sloping down toward the toes (+Z).
	prim(ctx, g, "Wedge", `{name}Toe`, Vector3.new(wid * 0.98, hgt * 0.45, len * 0.38), base * CFrame.new(0, 0.16 * s + hgt * 0.62, len * 0.3) * CFrame.Angles(0, math.pi, 0), shade(pal.boots, -1))
	prim(ctx, g, "Block", `{name}ToeBumper`, Vector3.new(wid * 1.02, 0.2 * s, 0.22 * s), base * CFrame.new(0, 0.22 * s, len * 0.48), pal.bootSole)
	-- Binding strap across the instep, and an ankle strap when there is a binding.
	ctx.bone = ctx.root
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
		local side = if dir > 0 then "L" else "R"
		local ankle = buildBoot(ctx, g, `{name}Boot`, dir * stance, deckTop, `{side}Ankle`)
		local hip = Vector3.new(dir * 0.3, hipY, -0.06)
		local mid = (ankle + hip) / 2
		local knee = Vector3.new(mid.X * 1.08, mid.Y - 0.05, mid.Z + p.KneeBend)
		local th = p.LegThickness
		ctx.bone = ctx.bones[`{side}Knee`]
		limb(ctx, g, `{name}Shin`, ankle + Vector3.new(0, -0.1, 0), knee, th * 0.98, th * 0.9, pal.pants, 3)
		joint(ctx, g, `{name}Knee`, knee, th * 1.02, shade(pal.pants, 1))
		ctx.bone = ctx.bones[`{side}Hip`]
		limb(ctx, g, `{name}Thigh`, knee, hip, th * 0.92, th, pal.pants, 3)
		-- Knee and hip joints so the bend reads as a rounded shape.
		joint(ctx, g, `{name}Hip`, hip, th * 1.08, shade(pal.pants, 0))
		-- Cuff over the boot, slightly flared.
		ctx.bone = ctx.bones[`{side}Knee`]
		prim(ctx, g, "Block", `{name}Cuff`, Vector3.new(th * 1.12, th * 0.42, th * 1.12), CFrame.new(ankle + Vector3.new(0, 0.05, 0.03)) * tilt(ctx), shade(pal.pants, -1))
		prim(ctx, g, "Block", `{name}CuffBevel`, Vector3.new(th * 1.04, th * 0.4, th * 1.04), CFrame.new(ankle + Vector3.new(0, 0.05, 0.03)) * CFrame.Angles(0, rad(45), 0), shade(pal.pants, -0.5))
		-- Cargo pocket on the outside of the thigh.
		ctx.bone = ctx.bones[`{side}Hip`]
		local thighMid = (knee + hip) / 2
		prim(ctx, g, "Block", `{name}Pocket`, Vector3.new(0.08, th * 0.5, th * 0.45), CFrame.new(thighMid + Vector3.new(dir * th * 0.5, -0.05, 0.03)) * tilt(ctx, 0.5), shade(pal.pants, 1.5))
		table.insert(hips, hip)
	end
	return hips[1], hips[2]
end

--[[
	Shaped torso. Stacked cross-sections (CONFIG.TorsoSections) taper from a
	narrow waist to a wider chest. Each section is a core block plus a
	narrower, deeper block, which bevels the four vertical edges so the body
	reads as rounded and faceted instead of a box. Returns the torso CFrame
	(origin at hip centre, +Y up the spine).
]]
local function buildTorso(ctx: Ctx, hipCentre: Vector3): CFrame
	local p = ctx.p
	local pal = ctx.palette
	local g = newGroup(ctx, "Torso")
	local w, h, d = p.TorsoWidth, p.TorsoHeight, p.TorsoDepth
	local torso = CFrame.new(hipCentre) * CFrame.Angles(0, rad(p.TorsoTwist), 0) * CFrame.Angles(rad(p.TorsoLean), 0, 0)
	local lower = pal.jacketLower or pal.jacket

	-- Pant waistband under the jacket (with the pelvis); the jacket above goes with the waist.
	ctx.bone = ctx.bones.Hips
	prim(ctx, g, "Block", "Waist", Vector3.new(w * 0.62, 0.24, d * 0.8), torso * CFrame.new(0, 0.04, 0), shade(pal.pants, 0))

	local y = 0.12
	for i, sec in CONFIG.TorsoSections do
		local sh = h * sec.h
		local color = if i <= 2 then lower else pal.jacket
		local cf = torso * CFrame.new(0, y + sh / 2, (i - 3) * 0.02) * tilt(ctx, 0.6)
		local sw, sd = w * sec.w, d * sec.d
		local steps = (i % 2) * 0.8 - 0.4 + jitter(ctx, 0.3)
		ctx.bone = if i == 1 then ctx.bones.Hips else ctx.bones.Waist
		prim(ctx, g, "Block", `Torso{i}`, Vector3.new(sw * 0.84, sh * 1.08, sd), cf, shade(color, steps))
		prim(ctx, g, "Block", `Torso{i}Side`, Vector3.new(sw, sh * 1.04, sd * 0.7), cf, shade(color, steps - 1))
		y += sh
	end
	-- Chest planes: two wedges facing up and forward so the chest catches the light.
	for _, side in { -1, 1 } do
		local cf = torso * CFrame.new(side * w * 0.22, 0.12 + h * 0.66, d * 0.47) * CFrame.Angles(0, math.pi, 0) * tilt(ctx, 0.5)
		prim(ctx, g, "Wedge", `Chest{side}`, Vector3.new(w * 0.4, h * 0.22, d * 0.14), cf, shade(pal.jacket, 1.5))
	end
	-- Hem band at the waist, two-tone line where the hoodie changes colour.
	ctx.bone = ctx.bones.Hips
	prim(ctx, g, "Block", "Hem", Vector3.new(w * 0.66, 0.12, d * 0.94), torso * CFrame.new(0, 0.16, 0), shade(lower, -1.5))
	-- Rounded shoulders.
	ctx.bone = ctx.bones.Waist
	for _, side in { -1, 1 } do
		joint(ctx, g, `Shoulder{side}`, (torso * CFrame.new(side * w * 0.44, 0.12 + h * 0.92, 0)).Position, p.ArmThickness * 1.45, shade(pal.jacket, 0.5))
	end
	-- Hood behind the neck.
	prim(ctx, g, "Block", "Collar", Vector3.new(w * 0.42, 0.2, d * 0.55), torso * CFrame.new(0, 0.12 + h * 1.0, -d * 0.1) * tilt(ctx, 0.5), shade(pal.jacket, -1))
	prim(ctx, g, "Wedge", "Hood", Vector3.new(w * 0.46, h * 0.26, d * 0.32), torso * CFrame.new(0, 0.12 + h * 0.9, -d * 0.52) * tilt(ctx, 0.5), shade(pal.jacket, -1.5))
	-- Zip pull and chest tab in the accent colour.
	prim(ctx, g, "Block", "ZipPull", Vector3.new(0.06, 0.22, 0.05), torso * CFrame.new(w * 0.06, 0.12 + h * 0.8, d * 0.52), pal.accent)
	prim(ctx, g, "Block", "Logo", Vector3.new(0.22, 0.06, 0.04), torso * CFrame.new(-w * 0.2, 0.12 + h * 0.76, d * 0.52), pal.accent)
	return torso
end

local function buildHead(ctx: Ctx, torso: CFrame)
	local p = ctx.p
	local pal = ctx.palette
	local g = newGroup(ctx, "Head")
	ctx.bone = ctx.bones.Neck
	local hs = p.HeadSize
	local neckTop = torso * CFrame.new(0, 0.12 + p.TorsoHeight + 0.1, 0.04)
	prim(ctx, g, "Block", "Neck", Vector3.new(hs * 0.36, 0.3, hs * 0.36), neckTop, shade(pal.skin, -1.5))
	prim(ctx, g, "Block", "NeckBevel", Vector3.new(hs * 0.34, 0.28, hs * 0.34), neckTop * CFrame.Angles(0, rad(45), 0), shade(pal.skin, -2))
	local head = neckTop * CFrame.new(0, 0.1 + hs * 0.5, 0) * CFrame.Angles(0, rad(p.HeadTurn), 0) * CFrame.Angles(rad(-p.TorsoLean * 0.6), 0, 0)
	-- Octagonal skull (a block plus one turned 45 degrees) over a narrower jaw.
	prim(ctx, g, "Block", "Skull", Vector3.new(hs * 0.9, hs * 0.78, hs * 0.94), head * CFrame.new(0, hs * 0.08, 0), pal.skin)
	prim(ctx, g, "Block", "SkullBevel", Vector3.new(hs * 0.78, hs * 0.76, hs * 0.78), head * CFrame.new(0, hs * 0.08, 0) * CFrame.Angles(0, rad(45), 0), shade(pal.skin, -0.8))
	prim(ctx, g, "Block", "Jaw", Vector3.new(hs * 0.7, hs * 0.34, hs * 0.76), head * CFrame.new(0, -hs * 0.3, hs * 0.04), shade(pal.skin, -0.4))
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

--[[
	Rest joint pivots (studs, rider space) for these proportions, mirror-
	symmetric across X = 0. The builders place the art around the same
	points, and RiderBuilder.rigDef hands them to the animator.
]]
local JOINTS = { "Hips", "Waist", "Neck", "LShoulder", "LElbow", "LWrist", "RShoulder", "RElbow", "RWrist", "LHip", "LKnee", "LAnkle", "RHip", "RKnee", "RAnkle" }
local PARENT = {
	Hips = "Root",
	Waist = "Hips",
	Neck = "Waist",
	LShoulder = "Waist",
	LElbow = "LShoulder",
	LWrist = "LElbow",
	RShoulder = "Waist",
	RElbow = "RShoulder",
	RWrist = "RElbow",
	LHip = "Hips",
	LKnee = "LHip",
	LAnkle = "LKnee",
	RHip = "Hips",
	RKnee = "RHip",
	RAnkle = "RKnee",
}
RiderBuilder.JOINTS = JOINTS
RiderBuilder.PARENT = PARENT

type Rest = { joints: { [string]: Vector3 }, head: Vector3, hipCentre: Vector3, deckTop: number, handLength: number }

local function restJoints(p: Proportions, board: BoardStyle, acc: Accessories): Rest
	local bc = CONFIG.Board
	local deckTop = if acc.Board then bc.Thickness * 0.7 else 0
	local s = p.BootSize
	local plate = if board.binding then 0.08 * s else 0
	local hipY = deckTop + plate + 0.88 * s + 1.95 - p.Crouch
	local hipCentre = Vector3.new(0, hipY, -0.06)
	local torso = CFrame.new(hipCentre) * CFrame.Angles(0, rad(p.TorsoTwist), 0) * CFrame.Angles(rad(p.TorsoLean), 0, 0)
	local w, h = p.TorsoWidth, p.TorsoHeight
	local j: { [string]: Vector3 } = {}
	j.Hips = hipCentre
	j.Waist = (torso * CFrame.new(0, 0.12 + h * 0.36, 0)).Position
	j.Neck = (torso * CFrame.new(0, 0.12 + h, 0.04)).Position
	local rg = CONFIG.Rig.RestGrip
	for _, dir in { 1, -1 } do
		local side = if dir > 0 then "L" else "R"
		local ankle = Vector3.new(dir * bc.Stance / 2, deckTop + plate + 0.16 * s + 0.64 * s, -1.3 * s * 0.12)
		local hip = Vector3.new(dir * 0.3, hipY, -0.06)
		local mid = (ankle + hip) / 2
		j[side .. "Hip"] = hip
		j[side .. "Knee"] = Vector3.new(mid.X * 1.08, mid.Y - 0.05, mid.Z + p.KneeBend)
		j[side .. "Ankle"] = ankle
		local shoulder = (torso * CFrame.new(dir * w * 0.44, 0.12 + h * 0.9, 0)).Position
		local grip = hipCentre + Vector3.new(dir * rg.X, rg.Y, rg.Z)
		local elbow = (shoulder + grip) / 2 + Vector3.new(dir * 0.15, -0.18, 0.12)
		j[side .. "Shoulder"] = shoulder
		j[side .. "Elbow"] = elbow
		j[side .. "Wrist"] = grip - (grip - elbow).Unit * (p.HandSize * 0.5)
	end
	local neckTop = torso * CFrame.new(0, 0.12 + h + 0.1, 0.04)
	local head = (neckTop * CFrame.new(0, 0.1 + p.HeadSize * 0.5, 0)).Position
	return { joints = j, head = head, hipCentre = hipCentre, deckTop = deckTop, handLength = p.HandSize * 0.5 }
end

local function buildArms(ctx: Ctx, rest: Rest)
	local p = ctx.p
	local pal = ctx.palette
	local g = newGroup(ctx, "Arms")
	local sleeves = pal.sleeves or pal.jacket
	for _, side in { "L", "R" } do
		local name = if side == "L" then "Front" else "Back"
		local shoulder = rest.joints[side .. "Shoulder"]
		local elbow = rest.joints[side .. "Elbow"]
		local wrist = rest.joints[side .. "Wrist"]
		local grip = wrist + (wrist - elbow).Unit * rest.handLength
		ctx.bone = ctx.bones[side .. "Shoulder"]
		limb(ctx, g, `{name}UpperArm`, shoulder, elbow, p.ArmThickness, p.ArmThickness * 0.92, pal.jacket, 2)
		ctx.bone = ctx.bones[side .. "Elbow"]
		joint(ctx, g, `{name}Elbow`, elbow, p.ArmThickness * 0.98, shade(sleeves, 0.5))
		limb(ctx, g, `{name}Forearm`, elbow, wrist, p.ArmThickness * 0.88, p.ArmThickness * 0.76, sleeves, 2)
		ctx.bone = ctx.bones[side .. "Wrist"]
		glove(ctx, g, `{name}Glove`, grip, (grip - elbow).Unit, pal.gloves)
	end
end

--[[
	The tow handle, its own Model ("Handle") with an anchored bar as its
	PrimaryPart, built about the origin with the bar along X. The client sets
	its CFrame from the animator every frame. Attachments: RopeAttachment
	(the rope Beam's end, at the middle), GripL and GripR (the two hands).
]]
local function buildHandle(ctx: Ctx): Model
	local pal = ctx.palette
	local hc = CONFIG.Handle
	local hg = Instance.new("Model")
	hg.Name = "Handle"
	hg.Parent = ctx.model
	local bar = CFrame.new()
	local barPart = Instance.new("Part")
	barPart.Name = "Bar"
	barPart.Shape = Enum.PartType.Cylinder
	barPart.Size = Vector3.new(hc.Length, hc.Radius * 2, hc.Radius * 2)
	barPart.CFrame = bar
	barPart.Color = pal.handle
	barPart.Material = CONFIG.Material
	barPart.Anchored = true
	barPart.CanCollide = false
	barPart.CanQuery = false
	barPart.CanTouch = false
	barPart.Parent = hg
	hg.PrimaryPart = barPart
	local saved = ctx.bone
	ctx.bone = barPart
	for k, sgn in { -1, 1 } do
		prim(ctx, hg, "Cylinder", `EndCap{k}`, Vector3.new(0.08, hc.Radius * 2.6, hc.Radius * 2.6), bar * CFrame.new(sgn * hc.Length / 2, 0, 0), pal.accent)
	end
	ctx.bone = saved
	local att = Instance.new("Attachment")
	att.Name = "RopeAttachment"
	att.Parent = barPart
	for name, x in { GripL = -hc.GripSpacing / 2, GripR = hc.GripSpacing / 2 } do
		local a = Instance.new("Attachment")
		a.Name = name
		a.Position = Vector3.new(x, 0, 0)
		a.Parent = barPart
	end
	return hg
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

local function resolve(opts: BuildOptions): (Palette, Accessories, Proportions, BoardStyle)
	local palette, accessories = resolvePalette(opts.palette)
	local accTable = accessories :: any
	for k, v in (opts.accessories or {}) :: { [string]: boolean } do
		accTable[k] = v
	end
	local proportions = table.clone(CONFIG.Proportions) :: any
	for k, v in (opts.proportions or {}) :: { [string]: number } do
		proportions[k] = v
	end
	local boardSpec = opts.board or CONFIG.DefaultBoard
	local boardStyle: BoardStyle
	if type(boardSpec) == "string" then
		local found = (CONFIG.BoardStyles :: any)[boardSpec]
		assert(found, `Unknown board style "{boardSpec}"`)
		boardStyle = found
	else
		boardStyle = boardSpec :: BoardStyle
	end
	return palette, accessories, proportions :: Proportions, boardStyle
end

--[[
	Build a rider Model. The Model is not parented; set Parent yourself.
	PrimaryPart is "Root", an invisible anchored block at the centre of the
	board base: the board and bindings are welded to it, and the body hangs
	off it through Motor6Ds (Root -> BoneHips -> ...). Moving the rider is
	one PivotTo call; posing it is setting each Motor6D's Transform.
]]
function RiderBuilder.build(options: BuildOptions?): Model
	local opts = options or {}
	local palette, accessories, proportions, boardStyle = resolve(opts)

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

	local rest = restJoints(proportions, boardStyle, accessories)
	-- One invisible bone part per joint, at its pivot, rest orientation identity.
	local bones: { [string]: BasePart } = {}
	local bonesFolder = Instance.new("Model")
	bonesFolder.Name = "Bones"
	bonesFolder.Parent = model
	for _, j in JOINTS do
		local b = Instance.new("Part")
		b.Name = "Bone" .. j
		b.Size = Vector3.new(0.2, 0.2, 0.2)
		b.CFrame = CFrame.new(rest.joints[j])
		b.Transparency = 1
		b.Anchored = false
		b.Massless = true
		b.CanCollide = false
		b.CanQuery = false
		b.CanTouch = false
		b.Parent = bonesFolder
		bones[j] = b
	end
	for _, j in JOINTS do
		local parentName = PARENT[j]
		local part0 = if parentName == "Root" then root else bones[parentName]
		local origin0 = if parentName == "Root" then root.CFrame.Position else rest.joints[parentName]
		local m = Instance.new("Motor6D")
		m.Name = j
		m.Part0 = part0
		m.Part1 = bones[j]
		m.C0 = CFrame.new(rest.joints[j] - origin0)
		m.C1 = CFrame.new()
		m.Parent = part0
	end

	local ctx: Ctx = {
		model = model,
		root = root,
		bone = nil,
		bones = bones,
		rng = Random.new(opts.seed or CONFIG.Seed),
		palette = palette,
		board = boardStyle,
		p = proportions,
		acc = accessories,
	}

	if accessories.Board then
		buildBoard(ctx)
	end
	buildLegs(ctx, rest.deckTop)
	local torso = buildTorso(ctx, rest.hipCentre)
	buildHead(ctx, torso)
	buildArms(ctx, rest)
	if accessories.Handle then
		buildHandle(ctx)
	end
	ctx.bone = nil

	if proportions.Scale ~= 1 then
		model:ScaleTo(proportions.Scale)
	end
	return model
end

--[[
	The animator's RigDef for riders built with these options: rest joint
	pivots relative to the board base, in metres (studs * MetresPerStud *
	Scale), plus the measurements the animation needs. Mirror-symmetric.
]]
function RiderBuilder.rigDef(options: BuildOptions?): any
	local opts = options or {}
	local _, accessories, proportions, boardStyle = resolve(opts)
	local rest = restJoints(proportions, boardStyle, accessories)
	local k = CONFIG.Rig.MetresPerStud * proportions.Scale
	local function m(v: Vector3)
		return { x = v.X * k, y = v.Y * k, z = v.Z * k }
	end
	local joints = {}
	for _, j in JOINTS do
		joints[j] = m(rest.joints[j])
	end
	return {
		name = "roblox",
		rest = joints,
		headCentre = m(rest.head),
		handLength = rest.handLength * k,
		boardLength = CONFIG.Board.Length * k,
		boardWidth = CONFIG.Board.Width * k,
		deckTop = rest.deckTop * k,
		barLength = CONFIG.Handle.Length * k,
		gripSpacing = CONFIG.Handle.GripSpacing * k,
	}
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
