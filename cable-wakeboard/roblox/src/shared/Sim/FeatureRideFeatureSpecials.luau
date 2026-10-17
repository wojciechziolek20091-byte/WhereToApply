-- Twin of src/sim/featureRide/featureSpecials.ts (FeatureSpecials, feature
-- riding spec 7): funbox down-end pops, rotations on slopes, a wall ride too
-- slow, and landing flat on the water past a spine.
local FeatureSpecials = {}

function FeatureSpecials.popScaleOn(piece, s)
	return if piece.h1 < piece.h0 then s.cfg.featureRide.Specials.DownEndPopScale else 1
end

function FeatureSpecials.slopedTurnHit(j, s)
	local S = s.cfg.featureRide.Specials
	return if math.abs(j.pitch) > S.SlopedTurnPitch then S.SlopedTurnHit else 0
end

function FeatureSpecials.wallTooSlow(up, s)
	return if up <= s.cfg.featureRide.Specials.WallSketchyHeight then "sketchy" else "wallSlideDown"
end

function FeatureSpecials.spineFlatLanding(s, air)
	if air.source ~= "kicker" or air.featureId == nil then
		return nil
	end
	local f = nil
	for _, x in s.features do
		if x.def.id == air.featureId then
			f = x
			break
		end
	end
	if not f or f.shape.type ~= "Spine" then
		return nil
	end
	return if -s.rider.vel.y > s.cfg.featureRide.Specials.SpineFlatCrash then "hard" else "flat"
end

function FeatureSpecials.markSpineFlat(landing)
	landing.clean = false
	landing.quality *= 0.6
end

return FeatureSpecials
