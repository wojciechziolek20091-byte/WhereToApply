-- Park layout as data, placed relative to the cable. Mirrors src/sim/park.ts.
-- `s` is the arc length along the cable where a feature starts, `offset` is
-- sideways from the cable line (+ right of travel).
local Vec = require(script.Parent.Vec)
local Cable = require(script.Parent.Cable)

local Park = {}

Park.DEFAULT_PARK = {
	name = "Gray-box park",
	features = {
		{ kind = "kicker", id = "k1", name = "Kicker 1", s = 75, offset = 0, length = 4.5, width = 3.5, height = 1.1, lipAngle = 0.5 },
		{ kind = "slider", id = "b1", name = "Fun box", style = "box", s = 150, offset = 0, length = 10, width = 0.6, height = 0.5, entryLength = 3 },
		{ kind = "kicker", id = "k3", name = "Side kicker", s = 112, offset = -9, length = 3.8, width = 3, height = 0.9, lipAngle = 0.45 },
		{ kind = "slider", id = "b2", name = "Wide box", style = "box", s = 190, offset = 8, length = 8, width = 1.0, height = 0.4, entryLength = 2.5 },
		{ kind = "slider", id = "b3", name = "Low box", style = "box", s = 372, offset = -8, length = 7, width = 0.8, height = 0.35, entryLength = 2.5 },
		{ kind = "kicker", id = "k2", name = "Kicker 2", s = 410, offset = 0, length = 5.5, width = 4, height = 1.6, lipAngle = 0.6 },
		{ kind = "slider", id = "r1", name = "Rail", style = "rail", s = 490, offset = 0, length = 8, width = 0.12, height = 0.6, entryLength = 3 },
		{ kind = "kicker", id = "k4", name = "Hip kicker", s = 455, offset = 9, length = 4.2, width = 3.2, height = 1.2, lipAngle = 0.55 },
		{ kind = "slider", id = "r2", name = "Long rail", style = "rail", s = 532, offset = -7, length = 10, width = 0.12, height = 0.5, entryLength = 3 },
	},
}

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
