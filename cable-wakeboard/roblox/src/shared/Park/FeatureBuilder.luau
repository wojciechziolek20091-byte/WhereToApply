--!strict
-- FeatureBuilder (features spec rule 2): builds a wake park feature as a
-- Roblox model from a catalogue name and a parameter table. The ride
-- surfaces come from Sim/FeatureShapes, the same pieces the sim rides, so
-- the Ride/ parts and the art line up with the physics exactly; the art is
-- low-poly and chunky to match the rest of the park.
--
--   local m = FeatureBuilder.build({ id = "L1_Funbox_01", catalog = "Funbox",
--       origin = Vector3.new(x, 0, z), heading = psi })
--   m.Parent = FeatureModel.featuresFolder()
--
-- Units: metres in, studs out (FeatureConfig.StudsPerMetre). Feature frame:
-- u along the axis, v to its right, h above the water (FeatureModel).
local FeatureConfig = require(script.Parent.FeatureConfig)
local FeatureModel = require(script.Parent.FeatureModel)
local FeatureShapes = require(script.Parent.Parent.Sim.FeatureShapes)

local FeatureBuilder = {}

local S = FeatureConfig.StudsPerMetre
local C = FeatureConfig.Colors

export type BuildSpec = {
	id: string,
	catalog: string,
	params: { [string]: any }?,
	side: number?,
	name: string?,
	-- Line accent colour name (FeatureConfig.Accents).
	accent: string?,
	origin: Vector3,
	heading: number,
}

type P3 = { u: number, v: number, h: number }

local function p3(u: number, v: number, h: number): P3
	return { u = u, v = v, h = h }
end

local function rgb(c: { number }): Color3
	return Color3.fromRGB(c[1], c[2], c[3])
end

local function material(name: string): Enum.Material
	return (Enum.Material :: any)[name]
end

-- Builder state for one model.
type Ctx = {
	model: Model,
	accent: Color3,
	top: Color3,
	rideIndex: number,
	shape: any,
}

-- Root-relative frame at the middle of a -> b, looking from a to b; up is the
-- surface normal (for horizontal across-axes), or `upHint` for walls.
local function segFrame(a: P3, b: P3, upHint: Vector3?): (CFrame, number)
	local du, dv, dh = b.u - a.u, b.v - a.v, b.h - a.h
	local len = math.sqrt(du * du + dv * dv + dh * dh)
	return FeatureModel.localFrame((a.u + b.u) / 2, (a.v + b.v) / 2, (a.h + b.h) / 2, du, dv, dh, upHint), len
end

-- A block whose top face runs along a -> b (width across, `thick` down from the line).
local function slab(ctx: Ctx, folder: FeatureModel.FolderName, name: string, a: P3, b: P3, width: number, thick: number, color: Color3, mat: string, upHint: Vector3?): BasePart
	local cf, len = segFrame(a, b, upHint)
	local p = FeatureModel.part(ctx.model, folder, name, Vector3.new(width * S, thick * S, len * S), cf * CFrame.new(0, -thick * S / 2, 0))
	p.Color = color
	p.Material = material(mat)
	return p
end

-- A cylinder along a -> b with its top on the line when `topOnLine`, else centred on it.
local function cyl(ctx: Ctx, folder: FeatureModel.FolderName, name: string, a: P3, b: P3, radius: number, color: Color3, mat: string, topOnLine: boolean): BasePart
	local cf, len = segFrame(a, b)
	local drop = if topOnLine then -radius * S else 0
	local p = FeatureModel.part(ctx.model, folder, name, Vector3.new(len * S, 2 * radius * S, 2 * radius * S), cf * CFrame.new(0, drop, 0) * CFrame.Angles(0, math.pi / 2, 0))
	p.Shape = Enum.PartType.Cylinder
	p.Color = color
	p.Material = material(mat)
	return p
end

-- An upright box centred at (u, v) from height h0 to h1.
local function post(ctx: Ctx, folder: FeatureModel.FolderName, name: string, u: number, v: number, h0: number, h1: number, w: number, d: number, color: Color3, mat: string): BasePart
	local p = FeatureModel.part(ctx.model, folder, name, Vector3.new(w * S, (h1 - h0) * S, d * S), CFrame.new(FeatureModel.offset(u, v, (h0 + h1) / 2)))
	p.Color = color
	p.Material = material(mat)
	return p
end

-- A thin right triangle (WedgePart) with its right angle at r and legs to a
-- and b, lying in their plane; its top face is on the plane, facing `up`.
local function tri(ctx: Ctx, folder: FeatureModel.FolderName, name: string, r: P3, a: P3, b: P3, thick: number, color: Color3, mat: string, up: Vector3?): BasePart
	local R = FeatureModel.offset(r.u, r.v, r.h)
	local A = FeatureModel.offset(a.u, a.v, a.h)
	local B = FeatureModel.offset(b.u, b.v, b.h)
	local ya, zb = A - R, B - R
	local sy, sz = ya.Magnitude, zb.Magnitude
	local Y = ya.Unit
	local Z = -zb.Unit
	local X = Y:Cross(Z)
	local n = if X:Dot(up or Vector3.new(0, 1, 0)) >= 0 then X else -X
	local centre = R + ya / 2 + zb / 2 - n * (thick * S / 2)
	local p = FeatureModel.part(ctx.model, folder, name, Vector3.new(thick * S, sy, sz), CFrame.fromMatrix(centre, X, Y, Z), "WedgePart")
	p.Color = color
	p.Material = material(mat)
	return p
end

-- Ride part for one straight stretch, with Start / End attachments on its top centre line.
local function ridePart(ctx: Ctx, piece: any, role: string, a: P3, b: P3, width: number, upHint: Vector3?): BasePart
	ctx.rideIndex += 1
	local round = piece.profile == "Round" and role ~= "Safety"
	local part: BasePart
	if round then
		part = cyl(ctx, "Ride", role .. ctx.rideIndex, a, b, piece.radius, rgb(C.Pipe), "Metal", true)
	else
		part = slab(ctx, "Ride", role .. ctx.rideIndex, a, b, width, 0.1, rgb(C.TopWhite), "SmoothPlastic", upHint)
	end
	local cf, len = segFrame(a, b, upHint)
	local root = (ctx.model.PrimaryPart :: BasePart).CFrame
	local inv = part.CFrame:Inverse()
	local startCf = inv * root * (cf * CFrame.new(0, 0, len * S / 2))
	local endCf = inv * root * (cf * CFrame.new(0, 0, -len * S / 2))
	FeatureModel.attachment(part, "Start", startCf)
	FeatureModel.attachment(part, "End", endCf)
	part:SetAttribute("SurfaceRole", role)
	part:SetAttribute("SegmentIndex", ctx.rideIndex)
	part:SetAttribute("PieceIndex", piece.index)
	part:SetAttribute("Part", piece.part)
	part:SetAttribute("Width", width * S)
	part:SetAttribute("Profile", if round then "Round" else "Flat")
	part:SetAttribute("Radius", piece.radius * S)
	part:SetAttribute("Slide", piece.slide)
	return part
end

-- Points along a piece's centre line (top surface), `n` segments.
local function pieceLine(piece: any, n: number): { P3 }
	local pts = {}
	for i = 0, n do
		local u = piece.u0 + (piece.u1 - piece.u0) * i / n
		local h = FeatureShapes.pieceHeightAt(piece, u).height
		table.insert(pts, p3(u, FeatureShapes.pieceCentre(piece, u), h))
	end
	return pts
end

-- Ride parts for an axis-'u' piece: one per straight piece, KickerSubsegments for curves.
local function rideAlong(ctx: Ctx, piece: any): { P3 }
	local n = if piece.power > 0 then FeatureConfig.KickerSubsegments else 1
	local pts = pieceLine(piece, n)
	for i = 1, n do
		local role = piece.role
		if piece.lip and i == n then
			role = "Lip"
		end
		local part = ridePart(ctx, piece, role, pts[i], pts[i + 1], piece.width)
		if role == "Lip" then
			-- LipPoint: the takeoff edge, LookVector along the launch direction.
			local a, b = pts[i], pts[i + 1]
			local cf = FeatureModel.localFrame(b.u, b.v, b.h, b.u - a.u, b.v - a.v, b.h - a.h)
			local root = (ctx.model.PrimaryPart :: BasePart).CFrame
			FeatureModel.attachment(part, "LipPoint", part.CFrame:Inverse() * root * cf)
		end
		if piece.role == "Safety" and i == n then
			local window = math.max(FeatureConfig.PopZoneLength, 0)
			local u = math.max(piece.u0, piece.u1 - window)
			local h = FeatureShapes.pieceHeightAt(piece, u).height
			local root = (ctx.model.PrimaryPart :: BasePart).CFrame
			local cf = FeatureModel.localFrame(u, FeatureShapes.pieceCentre(piece, u), h, piece.u1 - piece.u0, 0, piece.h1 - piece.h0)
			FeatureModel.attachment(part, "PopZoneStart", part.CFrame:Inverse() * root * cf)
			part:SetAttribute("PopZoneLength", window * S)
		end
	end
	return pts
end

-- Pontoon floats under a stretch of a feature, half under the water.
local function pontoons(ctx: Ctx, u0: number, u1: number, vc: number, halfWidth: number, radius: number)
	local color = rgb(C.PontoonWhite)
	for _, side in { -1, 1 } do
		cyl(ctx, "Visual", "Pontoon", p3(u0, vc + side * halfWidth, 0), p3(u1, vc + side * halfWidth, 0), radius, color, "Plastic", false)
	end
end

-- Frame legs from a line down to the pontoon deck, with an X brace between pairs.
local function frameUnder(ctx: Ctx, pts: { P3 }, halfWidth: number, deck: number)
	local grey = rgb(C.Frame)
	local first, last = pts[1], pts[#pts]
	local len = last.u - first.u
	local n = math.max(1, math.floor(len / 2.2))
	for i = 0, n do
		local u = first.u + len * i / n
		-- Height of the line at u (linear between the points).
		local h = first.h
		for k = 1, #pts - 1 do
			local a, b = pts[k], pts[k + 1]
			if u >= a.u and u <= b.u + 1e-9 then
				h = a.h + (b.h - a.h) * ((u - a.u) / math.max(b.u - a.u, 1e-9))
			end
		end
		local vc = first.v + (last.v - first.v) * (i / n)
		if h - 0.06 > deck then
			for _, side in { -1, 1 } do
				post(ctx, "Visual", "Leg", u, vc + side * (halfWidth - 0.05), deck, h - 0.06, 0.08, 0.08, grey, "DiamondPlate")
			end
			if i < n and h - deck > 0.3 then
				local u2 = first.u + len * (i + 1) / n
				slab(ctx, "Visual", "Brace", p3(u, vc - halfWidth + 0.05, deck + 0.05), p3(u2, vc - halfWidth + 0.05, h - 0.1), 0.05, 0.05, grey, "DiamondPlate")
			end
		end
	end
end

-- Coping: round edges along both top edges of a box stretch.
local function coping(ctx: Ctx, a: P3, b: P3, width: number)
	local r = FeatureConfig.CopingRadius
	for _, side in { -1, 1 } do
		cyl(ctx, "Visual", "Coping", p3(a.u, a.v + side * (width / 2 - r), a.h), p3(b.u, b.v + side * (width / 2 - r), b.h), r, rgb(C.Coping), "Metal", true)
	end
end

-- Side panel under a top-sheet stretch, down to `bottom`.
local function sidePanels(ctx: Ctx, a: P3, b: P3, width: number, bottom: number, color: Color3)
	for _, side in { -1, 1 } do
		local hTop = math.min(a.h, b.h) - FeatureConfig.TopSheet
		local hBot = bottom
		if hTop > hBot + 0.02 then
			-- A sloped quad approximated by a block following the top line.
			local mid = (math.max(a.h, b.h) - FeatureConfig.TopSheet + hBot) / 2
			local depth = math.max(a.h, b.h) - FeatureConfig.TopSheet - hBot
			slab(ctx, "Visual", "Side", p3(a.u, a.v + side * (width / 2 - 0.02), a.h - FeatureConfig.TopSheet), p3(b.u, b.v + side * (width / 2 - 0.02), b.h - FeatureConfig.TopSheet), 0.04, depth, color, "SmoothPlastic")
			local _ = mid
		end
	end
end

-- HDPE top sheet whose top face is the ride surface.
local function topSheet(ctx: Ctx, a: P3, b: P3, width: number): BasePart
	local p = slab(ctx, "Visual", "TopSheet", a, b, width, FeatureConfig.TopSheet, ctx.top, "SmoothPlastic")
	p.Reflectance = FeatureConfig.HDPEReflectance
	return p
end

-- Difficulty stripe across the leading edge of a stretch (one band, two for pro).
local function stripe(ctx: Ctx, at: P3, along: P3, width: number, difficulty: number, upHint: Vector3?)
	local d = FeatureConfig.Difficulty[difficulty]
	local color = rgb(d.color)
	local du, dv, dh = along.u - at.u, along.v - at.v, along.h - at.h
	local l = math.max(math.sqrt(du * du + dv * dv + dh * dh), 1e-6)
	du, dv, dh = du / l, dv / l, dh / l
	for k = 1, d.stripes do
		local o = (k - 1) * 0.22
		local a = p3(at.u + du * o, at.v + dv * o, at.h + dh * o + 0.004)
		local b = p3(at.u + du * (o + 0.15), at.v + dv * (o + 0.15), at.h + dh * (o + 0.15) + 0.004)
		slab(ctx, "Visual", "Stripe", a, b, width * 0.98, 0.01, color, "SmoothPlastic", upHint)
	end
end

-- Safety: a sloped HDPE ramp from under the water, accent sides.
local function buildSafety(ctx: Ctx, piece: any)
	local pts = rideAlong(ctx, piece)
	local a, b = pts[1], pts[#pts]
	topSheet(ctx, a, b, piece.width)
	sidePanels(ctx, a, b, piece.width, -0.3, ctx.accent)
	coping(ctx, a, b, piece.width)
end

-- A box main (flat or kinked stretch, exit ramp).
local function buildBoxStretch(ctx: Ctx, piece: any)
	local pts = rideAlong(ctx, piece)
	local a, b = pts[1], pts[#pts]
	topSheet(ctx, a, b, piece.width)
	sidePanels(ctx, a, b, piece.width, 0.05, ctx.accent)
	coping(ctx, a, b, piece.width)
	return pts
end

-- A flat slider rail: a narrow capped bar on posts.
local function buildRailStretch(ctx: Ctx, piece: any)
	local pts = rideAlong(ctx, piece)
	local a, b = pts[1], pts[#pts]
	topSheet(ctx, a, b, piece.width)
	slab(ctx, "Visual", "RailWeb", p3(a.u, a.v, a.h - FeatureConfig.TopSheet), p3(b.u, b.v, b.h - FeatureConfig.TopSheet), 0.06, 0.12, rgb(C.Frame), "DiamondPlate")
	return pts
end

-- A round pipe rail stretch.
local function buildPipeStretch(ctx: Ctx, piece: any)
	local pts = rideAlong(ctx, piece)
	local a, b = pts[1], pts[#pts]
	cyl(ctx, "Visual", "Pipe", a, b, piece.radius, rgb(C.Pipe), "Metal", true)
	return pts
end

-- Supports from a rail or pipe down to a pontoon pair under it.
local function railSupports(ctx: Ctx, pts: { P3 }, below: number)
	local grey = rgb(C.Frame)
	local first, last = pts[1], pts[#pts]
	local len = last.u - first.u
	local n = math.max(1, math.floor(len / 2.5))
	for i = 0, n do
		local u = first.u + len * i / n
		local h = first.h
		for k = 1, #pts - 1 do
			local a, b = pts[k], pts[k + 1]
			if u >= a.u and u <= b.u + 1e-9 then
				h = a.h + (b.h - a.h) * ((u - a.u) / math.max(b.u - a.u, 1e-9))
			end
		end
		local vc = first.v + (last.v - first.v) * (i / n)
		if h - below > 0.08 then
			post(ctx, "Visual", "Post", u, vc, 0.1, h - below, 0.08, 0.08, grey, "DiamondPlate")
			post(ctx, "Visual", "Foot", u, vc, 0.08, 0.14, 0.5, 0.12, grey, "DiamondPlate")
		end
	end
end

-- Kicker-style curved ramp: sub-segment top sheets with accent skirts, a frame wall under the lip.
local function buildCurvedRamp(ctx: Ctx, piece: any)
	local pts = rideAlong(ctx, piece)
	for i = 1, #pts - 1 do
		topSheet(ctx, pts[i], pts[i + 1], piece.width)
	end
	-- Skirts: one accent panel per side following the curve's chord, down to the water.
	for _, side in { -1, 1 } do
		for i = 1, #pts - 1 do
			local a, b = pts[i], pts[i + 1]
			local hTop = math.max(a.h, b.h) - FeatureConfig.TopSheet
			if hTop > 0.05 then
				local depth = hTop + 0.25
				slab(ctx, "Visual", "Skirt", p3(a.u, a.v + side * (piece.width / 2 + 0.02), a.h - FeatureConfig.TopSheet), p3(b.u, b.v + side * (piece.width / 2 + 0.02), b.h - FeatureConfig.TopSheet), 0.05, depth, ctx.accent, "SmoothPlastic")
			end
		end
	end
	local hi = if piece.h1 > piece.h0 then pts[#pts] else pts[1]
	-- Back wall under the high edge.
	post(ctx, "Visual", "BackWall", hi.u + (if piece.h1 > piece.h0 then 0.06 else -0.06), hi.v, -0.25, hi.h - FeatureConfig.TopSheet, 0.1, piece.width, rgb(C.Frame), "DiamondPlate")
	return pts
end

-- A sign post beside the feature with its difficulty colour.
local function sign(ctx: Ctx, u: number, v: number, label: string, difficulty: number)
	local d = FeatureConfig.Difficulty[difficulty]
	post(ctx, "Signage", "SignPost", u, v, 0, 1.6, 0.08, 0.08, rgb(C.Frame), "Metal")
	local board = post(ctx, "Signage", "SignBoard", u, v, 1.3, 1.9, 0.06, 0.9, rgb(C.Sign), "SmoothPlastic")
	board:SetAttribute("Label", label)
	post(ctx, "Signage", "SignBand", u + 0.035, v, 1.3, 1.42, 0.02, 0.9, rgb(d.color), "SmoothPlastic")
end

-- The ride pieces of a part (one main with its kinks), in order.
local function partPieces(shape: any, part: number): { any }
	local out = {}
	for _, piece in shape.pieces do
		if piece.part == part then
			table.insert(out, piece)
		end
	end
	return out
end

local function buildBoxLike(ctx: Ctx, entry: any, params: any)
	local shape = ctx.shape
	local style = params.style or (if entry.params.shape == "transfer" then "Box" else "Box")
	for _, piece in shape.pieces do
		if piece.role == "Safety" then
			buildSafety(ctx, piece)
		end
	end
	-- Mains, part by part.
	local parts: { [number]: boolean } = {}
	for _, piece in shape.pieces do
		if piece.slide then
			parts[piece.part] = true
		end
	end
	local firstMain = true
	for part in parts do
		local pieces = partPieces(shape, part)
		local line: { P3 } = {}
		local width = pieces[1].width
		for _, piece in pieces do
			local pts
			if style == "Pipe" then
				pts = buildPipeStretch(ctx, piece)
			elseif style == "Rail" then
				pts = buildRailStretch(ctx, piece)
			else
				pts = buildBoxStretch(ctx, piece)
			end
			for k, q in pts do
				if not (k == 1 and #line > 0) then
					table.insert(line, q)
				end
			end
		end
		if firstMain then
			local a, b = line[1], line[2]
			stripe(ctx, a, b, width, entry.meta.difficulty)
			firstMain = false
		end
		local above: { P3 } = {}
		for _, q in line do
			if q.h > 0.12 then
				table.insert(above, q)
			end
		end
		if #above >= 2 then
			if style == "Box" then
				frameUnder(ctx, above, width / 2, 0.12)
				pontoons(ctx, above[1].u, above[#above].u, (above[1].v + above[#above].v) / 2, math.max(width / 2 - 0.15, 0.2), 0.16)
			else
				local below = if style == "Pipe" then pieces[1].radius * 2 else FeatureConfig.TopSheet + 0.12
				railSupports(ctx, above, below)
				pontoons(ctx, above[1].u, above[#above].u, (above[1].v + above[#above].v) / 2, 0.3, 0.14)
			end
		end
	end
end

local function buildKicker(ctx: Ctx, entry: any)
	for _, piece in ctx.shape.pieces do
		local pts = buildCurvedRamp(ctx, piece)
		if piece.lip then
			local n = #pts
			stripe(ctx, pts[n - 1], pts[n], piece.width, entry.meta.difficulty)
		end
		pontoons(ctx, piece.u0 + 0.6, piece.u1 - 0.2, 0, piece.width / 2 - 0.3, 0.2)
	end
end

-- Build a feature model (not parented).
function FeatureBuilder.build(spec: BuildSpec): Model
	local entry, params = FeatureShapes.catalogParams(spec.catalog, spec.params)
	local shape = FeatureShapes.buildShape(spec.catalog, spec.params, spec.side or 1)
	local meta = entry.meta
	local model = FeatureModel.new({
		id = spec.id,
		name = spec.name or meta.label,
		catalog = spec.catalog,
		featureType = meta.type,
		difficulty = meta.difficulty,
		safetyMode = shape.safetyMode,
		lipHeight = if params.shape == "kicker" then params.lipHeight elseif params.shape == "spine" then params.peak else nil,
		lipAngle = if params.shape == "kicker" or params.shape == "spine" then params.lipAngle else nil,
		material = meta.material,
		friction = shape.friction,
		allowedSlides = meta.allowedSlides,
		bidirectional = meta.bidirectional,
		tag = meta.tag,
		origin = spec.origin,
		heading = spec.heading,
	})
	local accentName = spec.accent or "Orange"
	local ctx: Ctx = {
		model = model,
		accent = rgb((FeatureConfig.Accents :: any)[accentName]),
		top = if params.shape == "kicker" then rgb(C.TopWhite) else rgb(C.TopBlack),
		rideIndex = 0,
		shape = shape,
	}
	model:SetAttribute("Accent", accentName)
	if params.shape == "kicker" then
		buildKicker(ctx, entry)
	elseif params.shape == "box" or params.shape == "transfer" then
		buildBoxLike(ctx, entry, params)
	else
		FeatureBuilder.buildSpecial(ctx, entry, params)
	end
	sign(ctx, -1.5, shape.vMax + 2.5, spec.name or meta.label, meta.difficulty)
	return model
end

-- Points across a wall ride's profile at u, from d0 to d1 (n segments).
local function wallLine(piece: any, u: number, n: number): { P3 }
	local w = piece.wall
	local pts = {}
	for i = 0, n do
		local d = w.d0 + (w.d1 - w.d0) * i / n
		table.insert(pts, p3(u, w.base + w.side * d, FeatureShapes.wallHeightAt(w, d).height))
	end
	return pts
end

-- Wall ride: the transition in sub-segments and the wall as Ride parts, a
-- Skatelite face on top, a steel frame behind, accent end panels, a coping
-- bar along the top edge.
local function buildWall(ctx: Ctx, entry: any)
	local shape = ctx.shape
	local uMid = (shape.uMin + shape.uMax) / 2
	local len = shape.uMax - shape.uMin
	local face = rgb(C.Wall)
	local grey = rgb(C.Frame)
	local profile: { P3 } = {}
	for _, piece in shape.pieces do
		local n = if piece.role == "Transition" then 6 else 1
		local pts = wallLine(piece, uMid, n)
		local side = piece.wall.side
		local up = Vector3.new(-side, 0.2, 0)
		for i = 1, n do
			ridePart(ctx, piece, piece.role, pts[i], pts[i + 1], len, up)
			local sheet = slab(ctx, "Visual", "Face", pts[i], pts[i + 1], len, FeatureConfig.TopSheet, face, "SmoothPlastic", up)
			sheet.Reflectance = FeatureConfig.HDPEReflectance
		end
		for k, q in pts do
			if not (k == 1 and #profile > 0) then
				table.insert(profile, q)
			end
		end
	end
	local w = shape.pieces[1].wall
	local topPt = profile[#profile]
	-- Coping bar along the top edge (a crash edge too: over the top is a crash).
	cyl(ctx, "Visual", "TopCoping", p3(shape.uMin, topPt.v, topPt.h), p3(shape.uMax, topPt.v, topPt.h), 0.06, rgb(C.Coping), "Metal", false)
	-- Frame: posts behind the wall at each end and the middle, braced to a pontoon deck.
	local back = topPt.v + w.side * 0.35
	for _, u in { shape.uMin + 0.15, uMid, shape.uMax - 0.15 } do
		post(ctx, "Visual", "WallPost", u, back, -0.2, topPt.h, 0.14, 0.14, grey, "DiamondPlate")
		slab(ctx, "Visual", "WallBrace", p3(u, back, topPt.h - 0.2), p3(u, back + w.side * 1.4, 0.15), 0.08, 0.08, grey, "DiamondPlate")
	end
	slab(ctx, "Visual", "WallRail", p3(shape.uMin, back, topPt.h * 0.6), p3(shape.uMax, back, topPt.h * 0.6), 0.1, 0.1, grey, "DiamondPlate")
	-- Accent end panels following the profile: a block and a triangle per segment.
	for _, u in { shape.uMin - 0.03, shape.uMax + 0.03 } do
		for i = 1, #profile - 1 do
			local a, b = profile[i], profile[i + 1]
			local lo, hi = if a.h <= b.h then a else b, if a.h <= b.h then b else a
			if hi.h > 0 then
				local base = math.max(lo.h, -0.2)
				if base > -0.2 then
					post(ctx, "Visual", "EndPanel", u, (a.v + b.v) / 2, -0.2, base, math.abs(b.v - a.v) + 0.01, 0.05, ctx.accent, "SmoothPlastic")
				end
				tri(ctx, "Visual", "EndPanel", p3(u, hi.v, base), p3(u, hi.v, hi.h), p3(u, lo.v, base), 0.05, ctx.accent, "SmoothPlastic", Vector3.new(0, 0, 1))
			end
		end
	end
	pontoons(ctx, shape.uMin + 0.3, shape.uMax - 0.3, back + w.side * 0.7, 0.6, 0.22)
	stripe(ctx, profile[1], profile[2], len, entry.meta.difficulty, Vector3.new(-w.side, 0.2, 0))
end

-- Pyramid: four HDPE faces up to a flat top, accent skirts, pontoons.
local function buildPyramid(ctx: Ctx, entry: any, params: any)
	local shape = ctx.shape
	local front, top, backPiece = shape.pieces[1], shape.pieces[2], shape.pieces[3]
	local cap = front.cap
	local H = cap.top
	local d = -cap.bottom
	local half, halfTop = cap.half, cap.halfTop
	local uMid = (top.u0 + top.u1) / 2
	local _ = params
	-- Ride parts along the axis: the centre strip of each face and the top.
	for _, piece in { front, top, backPiece } do
		local pts = pieceLine(piece, 1)
		ridePart(ctx, piece, if piece.lip then "Ramp" else piece.role, pts[1], pts[2], 2 * halfTop)
	end
	-- Lip point on the front face's top edge.
	local fp = pieceLine(front, 1)
	local root = (ctx.model.PrimaryPart :: BasePart).CFrame
	local rideFolder = FeatureModel.folder(ctx.model, "Ride")
	local first = rideFolder:FindFirstChild("Ramp1") :: BasePart
	FeatureModel.attachment(first, "LipPoint", first.CFrame:Inverse() * root * FeatureModel.localFrame(fp[2].u, 0, fp[2].h, fp[2].u - fp[1].u, 0, fp[2].h - fp[1].h))
	-- Side faces as ride parts across the axis.
	for _, side in { -1, 1 } do
		local a = p3(uMid, side * half, -d)
		local b = p3(uMid, side * halfTop, H)
		local part = ridePart(ctx, top, "Ramp", a, b, top.u1 - top.u0, Vector3.new(0, 1, 0))
		part:SetAttribute("Axis", "v")
	end
	-- Faces: each a centre strip plus two right-triangle wedges, meeting at the hips exactly.
	local sheetColor = ctx.top
	local a = front.u1
	local uEnd = backPiece.u1
	local function sheet(p: BasePart)
		p.Reflectance = FeatureConfig.HDPEReflectance
	end
	for _, piece in { front, backPiece } do
		local pts = pieceLine(piece, 1)
		topSheet(ctx, pts[1], pts[2], 2 * halfTop)
	end
	topSheet(ctx, p3(top.u0, 0, H), p3(top.u1, 0, H), 2 * halfTop)
	for _, sd in { -1, 1 } do
		-- Side face strip, across the axis, as long as the top.
		local p = slab(ctx, "Visual", "SideFace", p3(uMid, sd * half, -d), p3(uMid, sd * halfTop, H), top.u1 - top.u0, FeatureConfig.TopSheet, sheetColor, "SmoothPlastic", Vector3.new(0, 1, 0))
		sheet(p)
		local th = FeatureConfig.TopSheet
		sheet(tri(ctx, "Visual", "FaceCorner", p3(0, sd * halfTop, -d), p3(a, sd * halfTop, H), p3(0, sd * half, -d), th, sheetColor, "SmoothPlastic"))
		sheet(tri(ctx, "Visual", "FaceCorner", p3(uEnd, sd * halfTop, -d), p3(top.u1, sd * halfTop, H), p3(uEnd, sd * half, -d), th, sheetColor, "SmoothPlastic"))
		sheet(tri(ctx, "Visual", "FaceCorner", p3(a, sd * half, -d), p3(a, sd * halfTop, H), p3(0, sd * half, -d), th, sheetColor, "SmoothPlastic"))
		sheet(tri(ctx, "Visual", "FaceCorner", p3(top.u1, sd * half, -d), p3(top.u1, sd * halfTop, H), p3(uEnd, sd * half, -d), th, sheetColor, "SmoothPlastic"))
	end
	-- Coping round the top, accent band at the waterline, pontoons under.
	for _, side in { -1, 1 } do
		cyl(ctx, "Visual", "Coping", p3(top.u0, side * halfTop, H), p3(top.u1, side * halfTop, H), 0.04, rgb(C.Coping), "Metal", true)
	end
	for _, uEdge in { top.u0, top.u1 } do
		cyl(ctx, "Visual", "Coping", p3(uEdge, -halfTop, H), p3(uEdge, halfTop, H), 0.04, rgb(C.Coping), "Metal", true)
	end
	local u0, u1 = shape.uMin, shape.uMax
	for _, side in { -1, 1 } do
		post(ctx, "Visual", "Skirt", (u0 + u1) / 2, side * (half - 0.4), -0.2, 0.12, 0.05, (u1 - u0) - 0.8, ctx.accent, "SmoothPlastic")
	end
	pontoons(ctx, u0 + 0.8, u1 - 0.8, 0, half - 1.2, 0.22)
	stripe(ctx, fp[2], fp[1], 2 * halfTop, entry.meta.difficulty)
end

-- Spine: a curved launch ramp to the peak, a straight landing slope down.
local function buildSpine(ctx: Ctx, entry: any)
	for _, piece in ctx.shape.pieces do
		local pts = buildCurvedRamp(ctx, piece)
		if piece.lip then
			stripe(ctx, pts[#pts - 1], pts[#pts], piece.width, entry.meta.difficulty)
		end
		pontoons(ctx, piece.u0 + 0.6, piece.u1 - 0.4, 0, piece.width / 2 - 0.3, 0.2)
	end
end

-- Wall rides, pyramids and spines.
function FeatureBuilder.buildSpecial(ctx: Ctx, entry: any, params: any)
	if params.shape == "wall" then
		buildWall(ctx, entry)
	elseif params.shape == "pyramid" then
		buildPyramid(ctx, entry, params)
	else
		buildSpine(ctx, entry)
	end
end

return FeatureBuilder
