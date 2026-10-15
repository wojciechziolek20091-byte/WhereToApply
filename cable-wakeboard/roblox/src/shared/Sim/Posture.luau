-- Handle distance, waist hinge, knee bend and connection. Mirrors src/sim/posture.ts.
local Scalar = require(script.Parent.Scalar)

local Posture = {}

function Posture.handleNorm(r, cfg)
	return Scalar.clamp01((r.handleDist - cfg.handleInDist) / (cfg.handleOutDist - cfg.handleInDist))
end

function Posture.connectionFactor(r, cfg)
	if r.handle == "dropped" then
		return 0
	end
	return Scalar.clamp01(1 - cfg.handleWeight * Posture.handleNorm(r, cfg) - cfg.hingeWeight * r.waistHinge)
end

function Posture.updatePosture(r, handleIn, loadHeld, tension, cfg, dt)
	local target = Scalar.lerp(cfg.handleOutDist, cfg.handleInDist, Scalar.clamp01(handleIn))
	r.handleDist = Scalar.approach(r.handleDist, target, cfg.handleRate * dt)
	local out = Posture.handleNorm(r, cfg)
	local pull = tension / cfg.hingeTensionRef
	local dHinge = cfg.hingeGain * pull * out - cfg.hingeRecovery * (1 - out)
	r.waistHinge = Scalar.clamp01(r.waistHinge + dHinge * dt)
	if loadHeld then
		r.legCompression = Scalar.approach(r.legCompression, 1, cfg.compressRate * dt)
	else
		r.legCompression = Scalar.approach(r.legCompression, 0, cfg.standRate * dt)
	end
	r.connection = Posture.connectionFactor(r, cfg)
end

return Posture
