-- Landing evaluation and fall kinds. Mirrors src/sim/landing.ts.
local Edge = require(script.Parent.Edge)
local Scalar = require(script.Parent.Scalar)
local Vec = require(script.Parent.Vec)

local Landing = {}

-- Without a spin the board follows travel, so only the spin counts.
function Landing.boardYaw(travelHeading, air)
	return travelHeading + air.spinAngle
end

function Landing.evaluateLanding(r, air, normal, cfg)
	local lc = cfg.landing
	local travel = if Vec.horizontalLength(r.vel) > 0.5 then Vec.headingOf(r.vel) else air.takeoffHeading
	local yawError = Scalar.wrapHalfTurn(Landing.boardYaw(travel, air) - travel)
	local halfTurns = Scalar.round(air.spinAngle / math.pi)
	local flips = if air.flipDir == 0 then 0 else math.max(1, Scalar.round(air.flipAngle / Scalar.TAU))
	local flipError = if air.flipDir == 0 then 0 else air.flipAngle - flips * Scalar.TAU
	local impact = math.max(0, -Vec.dot(r.vel, normal))
	local capacity = lc.stiffImpact + lc.absorbImpact * r.legCompression * (1 - r.waistHinge)

	local fall = nil
	if not r.hasHandle then
		fall = "droppedHandle"
	elseif math.abs(flipError) > lc.maxFlipError then
		fall = if flipError < 0 then "underRotation" else "overRotation"
	elseif math.abs(yawError) > lc.maxYawError then
		if not air.spinStarted then
			fall = "caughtEdge"
		else
			-- Short of the nearest half turn in the spin direction is under-rotation.
			local short = Scalar.sign(yawError) ~= Scalar.sign(air.spinAngle)
			fall = if short then "underRotation" else "overRotation"
		end
	elseif Edge.edgeNorm(r, cfg.edge) > lc.maxEdgeFraction then
		fall = "caughtEdge"
	elseif air.raleyExtension > 0.3 or impact > capacity then
		fall = "buttCheck"
	end

	local quality = 0
	if fall == nil then
		local q = Scalar.clamp01(impact / capacity)
		quality = Scalar.clamp01(
			1
				- 0.35 * (math.abs(yawError) / lc.maxYawError)
				- 0.3 * (math.abs(flipError) / lc.maxFlipError)
				- 0.35 * q * q
		)
	end
	return {
		fall = fall,
		impact = impact,
		quality = quality,
		yawError = yawError,
		flipError = flipError,
		halfTurns = halfTurns,
		flips = flips,
	}
end

return Landing
