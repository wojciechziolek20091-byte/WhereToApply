-- Planing board on flat water: drag along the board, edge grip sideways.
-- The sideways force is the edge load. Mirrors src/sim/hydro.ts.
local Vec = require(script.Parent.Vec)

local Hydro = {}

function Hydro.computeHydroForces(vel, heading, edgeNorm, cfg)
	local f = Vec.forwardOf(heading)
	local r = Vec.rightOf(heading)
	local vh = Vec.horizontal(vel)
	local vLong = Vec.dot(vh, f)
	local vLat = Vec.dot(vh, r)
	local speed = Vec.horizontalLength(vh)
	local grip = cfg.lateralGrip * (cfg.flatGripFraction + (1 - cfg.flatGripFraction) * edgeNorm)
	local latForce = -grip * vLat * math.max(speed, cfg.gripMinSpeed)
	local longForce = -cfg.dragCoef * vLong * math.abs(vLong)
	local linear = Vec.scale(vh, -cfg.linearDrag)
	local force = Vec.add(Vec.add(Vec.scale(f, longForce), Vec.scale(r, latForce)), linear)
	return { force = force, edgeLoad = math.abs(latForce), vLong = vLong, vLat = vLat }
end

return Hydro
