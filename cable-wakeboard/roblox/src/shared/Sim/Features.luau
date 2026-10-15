-- Feature geometry queries. Mirrors src/sim/features.ts.
local DetMath = require(script.Parent.DetMath)
local Vec = require(script.Parent.Vec)
local Park = require(script.Parent.Park)

local Features = {}

function Features.toLocal(f, pos)
	local d = Vec.sub(pos, f.origin)
	return { u = Vec.dot(d, Vec.forwardOf(f.heading)), v = Vec.dot(d, Vec.rightOf(f.heading)) }
end

function Features.toWorld(f, u, v, y)
	local p = Vec.addScaled(Vec.addScaled(f.origin, Vec.forwardOf(f.heading), u), Vec.rightOf(f.heading), v)
	return Vec.vec3(p.x, y, p.z)
end

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

function Features.insideFootprint(def, l, margin)
	margin = margin or 0
	return l.u >= -margin and l.u <= Park.featureLength(def) + margin and math.abs(l.v) <= def.width / 2 + margin
end

-- Surface under a local point, or nil outside the footprint.
function Features.surfaceAt(f, l)
	if not Features.insideFootprint(f.def, l) then
		return nil
	end
	local hs
	if f.def.kind == "kicker" then
		local k = Features.kickerHeightAt(f.def, l.u)
		hs = { height = k.height, slope = k.slope, onTop = false }
	else
		hs = Features.sliderHeightAt(f.def, l.u)
	end
	local fwd = Vec.forwardOf(f.heading)
	local tangent = Vec.normalize(Vec.addScaled(fwd, Vec.UP, hs.slope))
	local normal = Vec.normalize(Vec.addScaled(Vec.UP, fwd, -hs.slope))
	return { height = hs.height, slope = hs.slope, normal = normal, tangent = tangent, onTop = hs.onTop }
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
