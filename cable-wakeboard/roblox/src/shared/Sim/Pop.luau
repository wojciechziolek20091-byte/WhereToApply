-- Pop: edge load, hold, tension, timing, posture and knee bend into vertical
-- speed. Mirrors src/sim/pop.ts.
local Scalar = require(script.Parent.Scalar)

local Pop = {}

function Pop.computePop(i, cfg)
	local clamp01 = Scalar.clamp01
	local legs = cfg.base * (0.4 + 0.6 * clamp01(i.compression))
	local edge = cfg.edgeGain * clamp01(i.edgeLoadAtBase / cfg.edgeLoadRef) * clamp01(i.holdRatio)
	local line = cfg.tensionGain * clamp01(i.tensionAtRelease / cfg.tensionRef)
	local posture = 0.3 + 0.7 * clamp01(i.connection)
	local speed = math.min(cfg.maxPop, (legs + edge + line) * clamp01(i.timing) * posture)
	return { speed = speed, quality = speed / cfg.maxPop }
end

-- Kicker timing: ideal release `lipLead` seconds before leaving the lip.
function Pop.popTimingFactor(timeToLip, cfg)
	local err = (timeToLip - cfg.lipLead) / cfg.lipWindow
	return Scalar.clamp01(1 - err * err)
end

-- Track the recent peak edge load for flat-water pops.
function Pop.updateLoadTracker(t, edgeLoad, cfg, dt)
	if edgeLoad >= t.peakEdgeLoad then
		t.peakEdgeLoad = edgeLoad
		t.peakAge = 0
		return
	end
	t.peakAge += dt
	if t.peakAge > cfg.peakMemory then
		t.peakEdgeLoad = edgeLoad
		t.peakAge = 0
	end
end

function Pop.flatPopInputs(t, edgeLoad, tension, connection, compression, cfg)
	local loaded = t.peakEdgeLoad >= cfg.flatMinLoad
	return {
		edgeLoadAtBase = if loaded then t.peakEdgeLoad else 0,
		holdRatio = if t.peakEdgeLoad > 0 then edgeLoad / t.peakEdgeLoad else 0,
		tensionAtRelease = tension,
		timing = 1,
		connection = connection,
		compression = compression,
	}
end

return Pop
