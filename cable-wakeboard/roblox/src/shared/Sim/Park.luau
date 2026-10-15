-- Park layout as data, placed relative to the cable. Mirrors src/sim/park.ts.
-- `s` is the arc length along the cable where a feature starts, `offset` is
-- sideways from the cable line (+ right of travel).
local Vec = require(script.Parent.Vec)
local Cable = require(script.Parent.Cable)
local ParkLayout = require(script.Parent.ParkLayout)

local Park = {}

-- The park from the user's sketch, with scenery from their park map and photos (see ParkLayout.luau).
Park.DEFAULT_PARK = ParkLayout.LAKESIDE_PARK

-- No features: flat water only. Used by physics tests.
Park.FLAT_PARK = { name = "Flat water", features = {} }

function Park.resolvePark(park, path)
	local out = {}
	for i, def in park.features do
		local p = Cable.cablePointAt(path, def.s)
		local origin = Vec.addScaled(Vec.horizontal(p.pos), Vec.rightOf(p.heading), def.offset)
		out[i] = { def = def, origin = origin, heading = p.heading + (def.yaw or 0) }
	end
	return out
end

-- Total length of a feature along its axis.
function Park.featureLength(def)
	if def.kind == "kicker" then
		return def.length
	end
	return def.entryLength + def.length
end

return Park
