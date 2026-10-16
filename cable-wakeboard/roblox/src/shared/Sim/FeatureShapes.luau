-- Ride surfaces of a feature (features spec section 4.2), in the feature's
-- frame: u along its axis from its start, v to its right, heights above the
-- water. Mirrors src/sim/featureShapes.ts line for line (the TypeScript file
-- documents every field). The sim rides these pieces; FeatureBuilder builds a
-- Ride/ part for each from the same numbers.
local DetMath = require(script.Parent.DetMath)
local Vec = require(script.Parent.Vec)
local FeatureCatalog = require(script.Parent.FeatureCatalog)

local FeatureShapes = {}

local function piece(p)
	local out = {
		index = 0,
		part = 0,
		axis = "u",
		power = 0,
		v0 = 0,
		v1 = 0,
		profile = "Flat",
		radius = 0.04,
		slide = false,
		lip = false,
		closed = false,
		cap = false,
		wall = false,
	}
	for k, v in p do
		out[k] = v
	end
	return out
end

local function rad(d)
	return (d * math.pi) / 180
end

local function merge(a, b)
	local out = {}
	for k, v in a do
		out[k] = v
	end
	for k, v in b or {} do
		out[k] = v
	end
	return out
end

function FeatureShapes.powerFor(angle, len, rise)
	return math.max(1, (DetMath.tan(angle) * len) / rise)
end

local function kickerPieces(k, d)
	return {
		piece({
			role = "Ramp", u0 = 0, u1 = k.length, h0 = -d, h1 = k.lipHeight, width = k.width,
			power = FeatureShapes.powerFor(rad(k.lipAngle), k.length, k.lipHeight + d), lip = true,
		}),
	}
end

local function boxPieces(b, d)
	local out = {}
	local first = b.mains[1]
	local top = if b.safetyTop > 0 then b.safetyTop else first.height
	local run = if b.safetyLength > 0 then b.safetyLength else top / DetMath.tan(rad(b.safetyAngle))
	local ext = (d * run) / top
	local u = ext + run
	table.insert(out, piece({ role = "Safety", u0 = 0, u1 = u, h0 = -d, h1 = top, width = b.safetyWidth }))
	u += b.gap
	local round = b.style == "Pipe"
	local h = 0
	for k, m in b.mains do
		u += m.gapBefore
		h = m.height
		for _, kink in m.kinks do
			local a = rad(kink.angle)
			local du = kink.length * DetMath.cos(a)
			local dh = kink.length * DetMath.sin(a)
			table.insert(out, piece({
				role = "Main", u0 = u, u1 = u + du, h0 = h, h1 = h + dh, width = b.width, part = k, slide = true,
				profile = if round then "Round" else "Flat", radius = if round then b.width / 2 else 0.04,
			}))
			u += du
			h += dh
		end
	end
	if b.exitLength > 0 then
		local ext2 = (d * b.exitLength) / h
		table.insert(out, piece({ role = "ExitRamp", u0 = u, u1 = u + b.exitLength + ext2, h0 = h, h1 = -d, width = b.width, part = #b.mains, slide = true }))
	end
	return out
end

local function transferPieces(t, side, d)
	local run = t.height / DetMath.tan(rad(t.safetyAngle))
	local ext = (d * run) / t.height
	local a0 = ext + run
	local b0 = a0 + t.stagger
	local vb = side * (t.width + t.apart)
	local s = rad(t.splay)
	return {
		piece({ role = "Safety", u0 = 0, u1 = a0, h0 = -d, h1 = t.height, width = t.safetyWidth }),
		piece({ role = "Main", u0 = a0, u1 = a0 + t.length, h0 = t.height, h1 = t.height, width = t.width, part = 1, slide = true }),
		piece({
			role = "Main", u0 = b0, u1 = b0 + t.length * DetMath.cos(s), h0 = t.height, h1 = t.height, width = t.width, part = 2, slide = true,
			v0 = vb, v1 = vb + side * t.length * DetMath.sin(s),
		}),
	}
end

-- Wall ride cross-section: height at distance x out from the transition's bottom, and dh/dx.
function FeatureShapes.wallHeightAt(w, x)
	local dw = w.radius * DetMath.sin(w.angle)
	if x <= dw then
		local r = math.sqrt(math.max(w.radius * w.radius - x * x, 1e-9))
		return { height = -w.depth + w.radius - r, slope = x / r }
	end
	local hw = -w.depth + w.radius * (1 - DetMath.cos(w.angle))
	local t = DetMath.tan(w.angle)
	return { height = hw + (x - dw) * t, slope = t }
end

local function wallPieces(p, side)
	local angle = rad(p.angle)
	local dw = p.radius * DetMath.sin(angle)
	local hw = -p.depth + p.radius * (1 - DetMath.cos(angle))
	local dTop = dw + (p.height - hw) / DetMath.tan(angle)
	local function profile(d0, d1)
		return { side = side, base = side * p.standoff, radius = p.radius, angle = angle, depth = p.depth, top = p.height, d0 = d0, d1 = d1 }
	end
	return {
		piece({ axis = "v", u0 = 0, u1 = p.length, width = p.length, slide = true, radius = p.radius, role = "Transition", h0 = -p.depth, h1 = hw, wall = profile(0, dw) }),
		piece({ axis = "v", u0 = 0, u1 = p.length, width = p.length, slide = true, radius = 0.04, role = "Wall", h0 = hw, h1 = p.height, part = 0, wall = profile(dw, dTop) }),
	}
end

local function pyramidPieces(p, d)
	local run = (p.base - p.top) / 2
	local ext = (d * run) / p.height
	local half = p.base / 2 + ext
	local cap = { half = half, halfTop = p.top / 2, top = p.height, bottom = -d }
	local w = 2 * half
	local a = ext + run
	return {
		piece({ role = "Ramp", u0 = 0, u1 = a, h0 = -d, h1 = p.height, width = w, cap = cap, lip = true }),
		piece({ role = "Main", u0 = a, u1 = a + p.top, h0 = p.height, h1 = p.height, width = w, cap = cap, part = 1, slide = true }),
		piece({ role = "LandingRamp", u0 = a + p.top, u1 = 2 * a + p.top, h0 = p.height, h1 = -d, width = w, cap = cap, part = 2 }),
	}
end

local function spinePieces(p, d)
	local power = FeatureShapes.powerFor(rad(p.lipAngle), p.rampLength, p.peak + d)
	return {
		piece({ role = "Ramp", u0 = 0, u1 = p.rampLength, h0 = -d, h1 = p.peak, width = p.width, power = power, lip = true }),
		piece({ role = "LandingRamp", u0 = p.rampLength, u1 = 2 * p.rampLength, h0 = p.peak, h1 = -d, width = p.width, power = power, part = 1 }),
	}
end

local function finish(typeName, pieces, meta, safetyMode, legacy)
	local uMin, uMax, vMin, vMax = math.huge, -math.huge, math.huge, -math.huge
	for i, p in pieces do
		p.index = i
		local closed = true
		for _, q in pieces do
			if q ~= p and q.axis == p.axis and q.u0 == p.u1 then
				closed = false
			end
		end
		p.closed = closed
		uMin = math.min(uMin, p.u0)
		uMax = math.max(uMax, p.u1)
		if p.wall then
			local a = p.wall.base + p.wall.side * p.wall.d0
			local b = p.wall.base + p.wall.side * p.wall.d1
			vMin = math.min(vMin, a, b)
			vMax = math.max(vMax, a, b)
		else
			vMin = math.min(vMin, p.v0 - p.width / 2, p.v1 - p.width / 2)
			vMax = math.max(vMax, p.v0 + p.width / 2, p.v1 + p.width / 2)
		end
	end
	return {
		type = typeName,
		pieces = pieces,
		uMin = uMin,
		uMax = uMax,
		vMin = vMin,
		vMax = vMax,
		safetyMode = safetyMode,
		material = meta.material,
		friction = if legacy then false else FeatureCatalog.CATALOG_COMMON.friction[meta.material],
		bidirectional = meta.bidirectional,
		legacy = legacy,
	}
end

-- Catalogue params with overrides merged in (one level deep; `mains` replaces).
function FeatureShapes.catalogParams(name, overrides)
	local entry = FeatureCatalog.FEATURE_CATALOG[name]
	if not entry then
		error("unknown catalogue feature " .. tostring(name))
	end
	return entry, merge(entry.params, overrides)
end

-- Ride pieces of a catalogue feature. `side` (+1 right, -1 left) picks which
-- side a transfer's second box or a wall ride's wall is on.
function FeatureShapes.buildShape(name, overrides, side)
	side = side or 1
	local entry, params = FeatureShapes.catalogParams(name, overrides)
	local d = FeatureCatalog.CATALOG_COMMON.submerged
	local pieces
	local safety = "None"
	if params.shape == "kicker" then
		pieces = kickerPieces(params, d)
	elseif params.shape == "box" then
		pieces = boxPieces(params, d)
		safety = params.safetyMode
	elseif params.shape == "transfer" then
		pieces = transferPieces(params, side, d)
		safety = "Flush"
	elseif params.shape == "wall" then
		pieces = wallPieces(params, side)
	elseif params.shape == "pyramid" then
		pieces = pyramidPieces(params, d)
	else
		pieces = spinePieces(params, d)
	end
	return finish(entry.meta.type, pieces, entry.meta, safety, false)
end

-- The old kicker / slider defs as pieces: same numbers, same formulas.
function FeatureShapes.legacyShape(def)
	if def.kind == "kicker" then
		local p = piece({
			role = "Ramp", u0 = 0, u1 = def.length, h0 = 0, h1 = def.height, width = def.width,
			power = FeatureShapes.powerFor(def.lipAngle, def.length, def.height), lip = true,
		})
		return finish("Kicker", { p }, { material = "HDPE", bidirectional = false }, "None", true)
	end
	local round = def.style == "tube"
	local pieces = {
		piece({ role = "Safety", u0 = 0, u1 = def.entryLength, h0 = 0, h1 = def.height, width = def.width }),
		piece({
			role = "Main", u0 = def.entryLength, u1 = def.entryLength + def.length, h0 = def.height, h1 = def.height, width = def.width, part = 1, slide = true,
			profile = if round then "Round" else "Flat", radius = if round then def.width / 2 else 0.04,
		}),
	}
	local typeName = if def.style == "box" then "Slider" elseif def.style == "tube" then "PipeRail" else "FlatRail"
	return finish(typeName, pieces, { material = if round then "Pipe" else "HDPE", bidirectional = false }, if def.safety == "gap" then "Gap" else "Flush", true)
end

-- Centre line of a piece across the axis at u.
function FeatureShapes.pieceCentre(p, u)
	return p.v0 + (p.v1 - p.v0) * ((u - p.u0) / (p.u1 - p.u0))
end

-- Height and dh/du of an axis-'u' piece along its centre line.
function FeatureShapes.pieceHeightAt(p, u)
	local len = p.u1 - p.u0
	if p.power > 0 then
		local x = math.min(math.max((u - p.u0) / len, 0), 1)
		if p.h1 >= p.h0 then
			local rise = p.h1 - p.h0
			return { height = p.h0 + rise * DetMath.pow(x, p.power), slope = ((rise * p.power) / len) * DetMath.pow(x, p.power - 1) }
		end
		local drop = p.h0 - p.h1
		local w = 1 - x
		return { height = p.h1 + drop * DetMath.pow(w, p.power), slope = -((drop * p.power) / len) * DetMath.pow(w, p.power - 1) }
	end
	local slope = (p.h1 - p.h0) / len
	return { height = p.h0 + slope * (math.min(math.max(u, p.u0), p.u1) - p.u0), slope = slope }
end

local function inPiece(p, u, v)
	if u < p.u0 or u > p.u1 or (u == p.u1 and not p.closed) then
		return false
	end
	if p.wall then
		local x = (v - p.wall.base) * p.wall.side
		return x >= p.wall.d0 and (x < p.wall.d1 or (x == p.wall.d1 and p.role == "Wall"))
	end
	return math.abs(v - FeatureShapes.pieceCentre(p, u)) <= p.width / 2
end

local function surfaceOf(p, u, v)
	if p.wall then
		local x = (v - p.wall.base) * p.wall.side
		local w = FeatureShapes.wallHeightAt(p.wall, x)
		local normal = Vec.normalize(Vec.vec3(0, 1, -p.wall.side * w.slope))
		return { piece = p, height = w.height, slope = 0, crossSlope = w.slope, normal = normal, tangent = Vec.vec3(1, 0, 0) }
	end
	local along = FeatureShapes.pieceHeightAt(p, u)
	local k = (p.v1 - p.v0) / (p.u1 - p.u0)
	if p.cap then
		local dv = math.abs(v - FeatureShapes.pieceCentre(p, u))
		local fall = (p.cap.top - p.cap.bottom) / (p.cap.half - p.cap.halfTop)
		local side = if dv <= p.cap.halfTop then p.cap.top else p.cap.top - (dv - p.cap.halfTop) * fall
		if side < along.height then
			local sgn = if v >= FeatureShapes.pieceCentre(p, u) then 1 else -1
			return { piece = p, height = side, slope = 0, crossSlope = -fall, normal = Vec.normalize(Vec.vec3(0, 1, sgn * fall)), tangent = Vec.vec3(1, 0, 0) }
		end
	end
	local fwd = Vec.vec3(1, 0, k)
	return {
		piece = p,
		height = along.height,
		slope = along.slope,
		crossSlope = 0,
		normal = Vec.normalize(Vec.addScaled(Vec.UP, Vec.vec3(1, 0, 0), -along.slope)),
		tangent = Vec.normalize(Vec.addScaled(fwd, Vec.UP, along.slope)),
	}
end

-- Highest ride surface of a shape at (u, v), or nil off every piece. At a
-- joint the later piece wins, so a box's main starts exactly where its
-- safety ends.
function FeatureShapes.shapeSurfaceAt(shape, u, v)
	if u < shape.uMin or u > shape.uMax or v < shape.vMin or v > shape.vMax then
		return nil
	end
	local best = nil
	for _, p in shape.pieces do
		if inPiece(p, u, v) then
			local s = surfaceOf(p, u, v)
			if not best or s.height > best.height then
				best = s
			end
		end
	end
	return best
end

return FeatureShapes
