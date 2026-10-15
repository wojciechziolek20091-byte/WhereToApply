-- One-sided spring-damper between carrier and hips. Mirrors src/sim/rope.ts.
local Vec = require(script.Parent.Vec)

local Rope = {}

function Rope.computeRopeTension(carrierPos, carrierVel, hipPos, hipVel, effectiveLength, cfg)
	local toCarrier = Vec.sub(carrierPos, hipPos)
	local dist = Vec.length(toCarrier)
	local dir = if dist > 1e-9 then Vec.scale(toCarrier, 1 / dist) else Vec.vec3(0, 1, 0)
	-- d(dist)/dt: hips moving away from the carrier along the rope.
	local stretchRate = -Vec.dot(Vec.sub(hipVel, carrierVel), dir)
	local stretch = dist - effectiveLength
	if stretch <= 0 then
		return { tension = 0, dir = dir, force = Vec.vec3(), stretch = stretch, stretchRate = stretchRate }
	end
	local tension = math.max(0, cfg.stiffness * stretch + cfg.damping * stretchRate)
	return { tension = tension, dir = dir, force = Vec.scale(dir, tension), stretch = stretch, stretchRate = stretchRate }
end

return Rope
