-- Landing judgement. Mirrors src/sim/landing.ts.
local Scalar = require(script.Parent.Scalar)
local Vec = require(script.Parent.Vec)

local TAU = Scalar.TAU
local Landing = {}

function Landing.airSpin(air)
	return air.rot.spinAngle - air.spinStart
end

function Landing.invertAngle(air)
	if air.trick and air.trick.rollRate > 0 then
		return air.trick.rollAngle
	end
	return air.rot.flipAngle
end

function Landing.evaluateLanding(r, air, normal, cfg)
	local lc = cfg.landing
	local spin = air.rot.spinAngle
	local yawError = Scalar.wrapHalfTurn(spin)
	local halfTurns = Scalar.round(Landing.airSpin(air) / math.pi)
	local inv = Landing.invertAngle(air)
	local rolling = air.trick ~= nil and air.trick.rollRate > 0
	local flips = if rolling then math.max(1, Scalar.round(inv / TAU)) else Scalar.round(math.abs(inv) / TAU)
	local flipError = if rolling then inv - flips * TAU else math.abs(inv) - flips * TAU
	local impact = math.max(0, -Vec.dot(r.vel, normal))
	local capacity = lc.stiffImpact + lc.absorbImpact * r.legCompression * (1 - r.waistHinge)
	local extension = if air.trick then air.trick.extension else 0

	local crash = nil
	if r.handle == "dropped" then
		crash = "handleDropped"
	elseif math.abs(flipError) > lc.maxFlipError then
		crash = if flipError < 0 then "underRotated" else "overRotated"
	elseif math.abs(yawError) > lc.maxYawError then
		if air.rot.spinSide == nil and air.spinStart == 0 then
			crash = "badLandingYaw"
		else
			local dir = if air.rot.spinDir ~= 0 then air.rot.spinDir else Scalar.sign(spin)
			local k = Scalar.round(Landing.airSpin(air) / math.pi)
			crash = if Scalar.sign(yawError) == -dir or (k == 0 and air.rot.spinSide ~= nil) then "underRotated" else "overRotated"
		end
	elseif air.grab and lc.grabHeldCrashes then
		crash = "grabHeldOnLanding"
	elseif extension > cfg.waterTrick.maxLandingExtension then
		crash = "raleyExtendedOnLanding"
	elseif impact > capacity then
		crash = "hardLanding"
	end

	local worst = math.max(math.abs(yawError), math.abs(flipError))
	local clean = crash == nil and worst < lc.cleanThreshold
	local quality = 0
	if crash == nil then
		quality = Scalar.clamp01(
			1
				- 0.4 * (math.abs(yawError) / lc.maxYawError)
				- 0.3 * (math.abs(flipError) / lc.maxFlipError)
				- 0.3 * Scalar.clamp01(impact / capacity)
		)
	end
	return {
		crash = crash,
		impact = impact,
		quality = quality,
		clean = clean,
		yawError = yawError,
		flipError = flipError,
		halfTurns = halfTurns,
		flips = flips,
		toBlind = r.handle == "behind",
	}
end

return Landing
