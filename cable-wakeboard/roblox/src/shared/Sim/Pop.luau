-- Ollie charge, tension tracking and water-trick timing. Mirrors src/sim/pop.ts.
local DetMath = require(script.Parent.DetMath)
local Scalar = require(script.Parent.Scalar)

local Pop = {}

function Pop.ollieCharge(heldTime, cfg)
	return Scalar.clamp01(heldTime / cfg.ollie.chargeTime)
end

function Pop.ollieSpeed(charge, cfg)
	return Scalar.lerp(cfg.ollie.minV, cfg.ollie.maxV, Scalar.clamp01(charge))
end

function Pop.updateTensionTracker(r, cfg, dt)
	local alpha = 1 - DetMath.exp(-dt / cfg.rope.smoothTau)
	r.tensionPrev2 = r.tensionPrev
	r.tensionPrev = r.tensionSmooth
	r.tensionSmooth += (r.ropeTension - r.tensionSmooth) * alpha
	if r.tensionSmooth >= r.tensionPeak then
		r.tensionPeak = r.tensionSmooth
		r.tensionPeakAge = 0
		return
	end
	r.tensionPeakAge += dt
	if r.tensionPeakAge > cfg.waterTrick.historyTime then
		r.tensionPeak = r.tensionSmooth
		r.tensionPeakAge = 0
	end
end

function Pop.waterTrickTiming(r, cfg, dt)
	local wt = cfg.waterTrick
	if r.tensionPeakAge > 0 then
		return 1 - Scalar.clamp01(r.tensionPeakAge / wt.peakWindow)
	end
	local d1 = (r.tensionSmooth - r.tensionPrev) / dt
	local d2 = (r.tensionSmooth - 2 * r.tensionPrev + r.tensionPrev2) / (dt * dt)
	if d1 <= 0 then
		return 1
	end
	local timeToPeak = if d2 < 0 then -d1 / d2 else wt.peakWindow
	return 1 - Scalar.clamp01(timeToPeak / wt.peakWindow)
end

function Pop.waterTrickHeight(tension, timing, cfg)
	local wt = cfg.waterTrick
	local h = wt.baseHeight * DetMath.pow(math.max(0, tension) / wt.tensionThreshold, 1.2) * (0.5 + 0.5 * Scalar.clamp01(timing))
	return math.min(wt.maxHeight, h)
end

return Pop
