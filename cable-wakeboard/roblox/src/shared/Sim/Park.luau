-- Park layout as data, placed relative to the cable. Mirrors src/sim/park.ts.
-- `s` is the arc length along the cable where a feature starts, `offset` is
-- sideways from the cable line (+ right of travel).
local Vec = require(script.Parent.Vec)
local Cable = require(script.Parent.Cable)
local ParkLayout = require(script.Parent.ParkLayout)
local FeatureShapes = require(script.Parent.FeatureShapes)

local Park = {}

-- The park from the user's sketch, with scenery from their park map and photos (see ParkLayout.luau).
Park.DEFAULT_PARK = ParkLayout.LAKESIDE_PARK

-- No features: flat water only. Used by physics tests.
Park.FLAT_PARK = { name = "Flat water", features = {} }

-- Ride pieces of any feature def.
function Park.shapeOfDef(def)
	if def.kind == "feature" then
		return FeatureShapes.buildShape(def.catalog, def.params, def.side or 1)
	end
	return FeatureShapes.legacyShape(def)
end

function Park.resolvePark(park, path)
	local out = {}
	for i, def in park.features do
		local p = Cable.cablePointAt(path, def.s)
		local origin = Vec.addScaled(Vec.horizontal(p.pos), Vec.rightOf(p.heading), def.offset)
		out[i] = { def = def, origin = origin, heading = p.heading + (def.yaw or 0), shape = Park.shapeOfDef(def) }
	end
	return out
end

-- Total length of a feature along its axis.
function Park.featureLength(def)
	if def.kind == "kicker" then
		return def.length
	end
	if def.kind == "slider" then
		return def.entryLength + def.length
	end
	return Park.shapeOfDef(def).uMax
end

-- Footprint width of a feature across its axis.
function Park.featureWidth(def)
	if def.kind ~= "feature" then
		return def.width
	end
	local sh = Park.shapeOfDef(def)
	return sh.vMax - sh.vMin
end

return Park
