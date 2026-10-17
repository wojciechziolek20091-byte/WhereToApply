-- Twin of src/sim/featureRide/slideController.ts (SlideController, feature
-- riding spec 5.1, 5.6, 5.7): friction by material and slide, stalls, kinks
-- and the two-axis balance meter.
local Config = require(script.Parent.Config)
local Noise = require(script.Parent.Noise)
local Scalar = require(script.Parent.Scalar)

local DT = Config.DT
local SlideController = {}

function SlideController.isBoardslide(boardAngle)
	return Scalar.mod(Scalar.round(boardAngle / (math.pi / 2)), 2) == 1
end

function SlideController.slideFriction(f, j, s)
	local S = s.cfg.featureRide.Slide
	local mu = f.shape.friction or S.MaterialFriction[f.shape.material] or s.cfg.feature.friction
	return mu * (if SlideController.isBoardslide(j.boardAngle) then S.BoardslideFriction else 1)
end

local function busy(input)
	return input.steer ~= 0 or input.pop or input.forward or input.back
end

function SlideController.stepKink(s, j, pitch, speed, input)
	local S = s.cfg.featureRide.Slide
	local d = j.pitch - pitch
	j.pitch = pitch
	if j.lift > 0 then
		j.lift = math.max(0, j.lift - DT)
		if j.lift == 0 and busy(input) then
			j.balance += S.KinkHit * (if j.balance >= 0 then 1 else -1)
		end
	end
	if d < S.KinkMinAngle then
		return nil
	end
	if d > S.KinkCheckAngle then
		local limit = (S.KinkThrowSpeed * S.KinkCheckAngle) / d
		if speed > limit * (1 + S.KinkSketchyMargin) then
			return "kinkThrow"
		end
		if speed > limit then
			j.sketchy = true
			j.balance += S.KinkSketchyHit * (if j.balance >= 0 then 1 else -1)
		end
	end
	local lift = math.min(S.KinkLiftPerRadSpeed * d * speed, S.KinkLiftMax)
	if lift >= S.KinkLiftMin then
		j.lift = lift
	end
	return nil
end

function SlideController.partEnd(f, part)
	local u1 = -math.huge
	for _, q in f.shape.pieces do
		if q.part == part and q.slide and q.axis == "u" and q.u1 > u1 then
			u1 = q.u1
		end
	end
	return u1
end

function SlideController.stepBalance(s, j, f, piece, surface, u, ropeLat, ropeAlong, mem)
	local r, cfg = s.rider, s.cfg
	local B = cfg.featureRide.Balance
	if not cfg.feature.balanceEnabled then
		return nil
	end
	if r.ropeTension > B.SpikeTension then
		if not j.spiked then
			j.balance += B.SpikeImpulse * Scalar.sign(ropeLat)
		end
		j.spiked = true
	elseif r.ropeTension < B.SpikeTension * 0.9 then
		j.spiked = false
	end
	local round = piece.profile == "Round"
	local top = if round then B.NoisePipe elseif piece.width >= B.BoxMinWidth then B.NoiseBox else B.NoiseRail
	local board = SlideController.isBoardslide(j.boardAngle)
	local bySlide = if round
		then (if board then B.PipeBoardslideFactor else B.PipeFiftyFactor)
		elseif board then B.BoardslideFactor
		else 1
	local noise = Noise.valueNoise(j.time * B.NoiseRate, j.noiseSeed)
	j.balance += (noise * top * bySlide + ropeLat / B.RopeTip + surface.crossSlope * B.CrossSlopeGain) * DT + mem.steerTap * B.TapStrength
	if board then
		local n2 = Noise.valueNoise(j.time * B.NoiseRate + 57.3, j.noiseSeed + 1)
		j.fore += (n2 * B.ForeNoise + ropeAlong / B.ForeRopeTip - surface.slope * B.ForeSlopeGain) * DT + mem.foreTap * B.ForeTapStrength
	else
		j.fore = Scalar.approach(j.fore, 0, B.ForeDecay * DT)
	end
	j.fore = Scalar.clamp(j.fore, -2, 2)
	if math.abs(j.balance) <= 1 and math.abs(j.fore) <= 1 then
		return nil
	end
	return if SlideController.partEnd(f, piece.part) - u < B.LastMetre then "sketchyExit" else "fell"
end

return SlideController
