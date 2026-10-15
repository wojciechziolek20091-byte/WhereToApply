-- Handle system: pass zones, windows, spin to blind, coming back out.
-- Mirrors src/sim/handle.ts (see there for the rules).
local Scalar = require(script.Parent.Scalar)

local TAU = Scalar.TAU
local Handle = {}

function Handle.passZone(side, k)
	local start = (if side == "backside" then math.pi / 2 else math.pi) + k * TAU
	return { start = start, ["end"] = start + math.pi / 2 }
end

function Handle.handleProgress(rot)
	return rot.progressOffset + rot.spinAngle * rot.startDir
end

function Handle.passWindowOf(rot, ctx)
	if rot.spinSide == nil then
		return nil
	end
	local zone = Handle.passZone(rot.spinSide, rot.zonesResolved)
	return { centre = zone.start + math.pi / 4, half = (rot.passWindow / 2) * ctx.rate, zone = zone }
end

-- One tick of the handle. Returns the new handle state and what happened.
function Handle.updateHandle(handle, rot, passPressed, ctx, cfg, dt)
	local result = { passed = false, dropped = false, wentBlind = false, cameOut = false }
	if handle == "dropped" then
		return handle, result
	end
	if rot.passTimer > 0 then
		rot.passTimer = math.max(0, rot.passTimer - dt)
		if rot.passTimer == 0 and handle == "passing" then
			handle = "inFront"
		end
	end
	local w = Handle.passWindowOf(rot, ctx)
	if not w then
		return handle, result
	end
	local p = Handle.handleProgress(rot)

	if handle == "behind" then
		local prev = Handle.passZone(rot.spinSide, rot.zonesResolved - 1)
		if p <= prev.start then
			handle = "inFront"
			rot.zonesResolved -= 1
			rot.stoppedByRope = false
			result.cameOut = true
		end
		return handle, result
	end
	if handle == "passing" then
		return handle, result
	end

	if passPressed then
		if math.abs(p - w.centre) <= w.half then
			rot.passes += 1
			rot.zonesResolved += 1
			rot.passTimer = cfg.handlePass.passTime
			result.passed = true
			return "passing", result
		end
		result.dropped = true
		return "dropped", result
	end

	local missedBackside = rot.spinSide == "backside" and p >= w.zone["end"]
	local missedFrontside = rot.spinSide == "frontside" and p > w.centre + w.half
	if missedBackside or missedFrontside then
		if not ctx.inAir then
			result.dropped = true
			return "dropped", result
		end
		if missedBackside then
			rot.spinAngle = (w.zone["end"] - rot.progressOffset) * rot.startDir
			rot.spinRate = 0
			rot.spinTarget = nil
			rot.stoppedByRope = true
			rot.blindDir = rot.startDir
			rot.zonesResolved += 1
			result.wentBlind = true
			return "behind", result
		end
		rot.spinTarget = (w.zone.start - rot.progressOffset) * rot.startDir
		rot.stoppedByRope = true
		rot.spinRate = -rot.startDir * ctx.rate
	end
	return handle, result
end

return Handle
