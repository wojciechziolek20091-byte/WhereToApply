-- Feature geometry queries. Mirrors src/sim/features.ts.
local DetMath = require(script.Parent.DetMath)
local Vec = require(script.Parent.Vec)
local FeatureShapes = require(script.Parent.FeatureShapes)

local Features = {}

function Features.toLocal(f, pos)
	local d = Vec.sub(pos, f.origin)
	return { u = Vec.dot(d, Vec.forwardOf(f.heading)), v = Vec.dot(d, Vec.rightOf(f.heading)) }
end

function Features.toWorld(f, u, v, y)
	local p = Vec.addScaled(Vec.addScaled(f.origin, Vec.forwardOf(f.heading), u), Vec.rightOf(f.heading), v)
	return Vec.vec3(p.x, y, p.z)
end

-- The old kicker and slider formulas; the sim now rides FeatureShapes pieces, which give the same numbers.
-- Kicker exponent so the slope at the lip equals tan(lipAngle).
function Features.kickerExponent(k)
	return math.max(1, (DetMath.tan(k.lipAngle) * k.length) / k.height)
end

function Features.kickerHeightAt(k, u)
	local x = math.min(math.max(u / k.length, 0), 1)
	local p = Features.kickerExponent(k)
	return { height = k.height * DetMath.pow(x, p), slope = ((k.height * p) / k.length) * DetMath.pow(x, p - 1) }
end

function Features.sliderHeightAt(sd, u)
	if u < sd.entryLength then
		local slope = sd.height / sd.entryLength
		return { height = math.max(0, u) * slope, slope = slope, onTop = false }
	end
	return { height = sd.height, slope = 0, onTop = true }
end

-- Heading of a piece's centre line (splayed boxes turn off the feature's axis).
function Features.pieceHeading(f, p)
	if p.v1 == p.v0 then
		return f.heading
	end
	return f.heading + DetMath.atan2(p.v1 - p.v0, p.u1 - p.u0)
end

-- Distance across a piece from its centre line.
function Features.offCentre(p, l)
	return l.v - FeatureShapes.pieceCentre(p, l.u)
end

-- Surface under a local point, or nil off every ride piece.
function Features.surfaceAt(f, l)
	local s = FeatureShapes.shapeSurfaceAt(f.shape, l.u, l.v)
	if not s then
		return nil
	end
	local p = s.piece
	local fwd = Vec.forwardOf(f.heading)
	local right = Vec.rightOf(f.heading)
	if s.crossSlope ~= 0 or p.wall then
		local normal = Vec.normalize(Vec.addScaled(Vec.addScaled(Vec.scale(Vec.UP, s.normal.y), fwd, s.normal.x), right, s.normal.z))
		return { height = s.height, slope = 0, normal = normal, tangent = fwd, onTop = p.slide, piece = p, crossSlope = s.crossSlope }
	end
	local k = (p.v1 - p.v0) / (p.u1 - p.u0)
	local along = Vec.addScaled(fwd, right, k)
	local tangent = Vec.normalize(Vec.addScaled(along, Vec.UP, s.slope))
	local normal = Vec.normalize(Vec.addScaled(Vec.UP, fwd, -s.slope))
	return { height = s.height, slope = s.slope, normal = normal, tangent = tangent, onTop = p.slide, piece = p, crossSlope = 0 }
end

-- Highest feature surface under a world position, or nil.
function Features.featureUnder(features, pos)
	local best = nil
	for _, feature in features do
		local l = Features.toLocal(feature, pos)
		local surface = Features.surfaceAt(feature, l)
		if surface and (best == nil or surface.height > best.surface.height) then
			best = { feature = feature, ["local"] = l, surface = surface }
		end
	end
	return best
end

return Features
