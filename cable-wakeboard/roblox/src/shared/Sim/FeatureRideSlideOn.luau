-- Twin of src/sim/featureRide/slideOn.ts (slide-on, side approaches spec):
-- reading the approach (turn-in, inward speed, contact point, edge type,
-- availability).
local DetMath = require(script.Parent.DetMath)
local FeatureShapes = require(script.Parent.FeatureShapes)
local SlideController = require(script.Parent.FeatureRideSlideController)
local SlideOnConfig = require(script.Parent.FeatureRideSlideOnConfig)
local Vec = require(script.Parent.Vec)

local SlideOn = {}

function SlideOn.sideTypeOf(f, p, s)
	if f.def.sideType then
		return f.def.sideType
	end
	if p.wall then
		return "Wall"
	end
	if p.profile == "Round" then
		return "Round"
	end
	for _, q in f.shape.pieces do
		if q.cap ~= nil then
			return "Bank"
		end
	end
	if p.width < s.cfg.slideOn.RailMaxWidth then
		return "Rail"
	end
	return "Rounded"
end

function SlideOn.topPieceAt(f, u)
	for _, p in f.shape.pieces do
		if p.slide and p.axis == "u" and not p.wall and u >= p.u0 and u <= p.u1 then
			return p
		end
	end
	return nil
end

function SlideOn.assessSlideOn(s, f, l, a)
	local r, cfg = s.rider, s.cfg
	local S = cfg.slideOn
	local sh = f.shape
	local along = Vec.dot(r.vel, Vec.forwardOf(f.heading))
	local across = Vec.dot(r.vel, Vec.rightOf(f.heading))
	local toward = if l.v < sh.vMin then 1 elseif l.v > sh.vMax then -1 else 0
	local inward = across * toward
	a.inwardSpeed = inward
	a.turnIn = if toward == 0 then 0 else DetMath.atan2(inward, math.abs(along))
	a.contactU = if toward ~= 0 and inward > 0.05 then l.u + (along * a.sideGap) / inward else l.u
	local p = SlideOn.topPieceAt(f, a.contactU)
	a.topHeight = if p then FeatureShapes.pieceHeightAt(p, a.contactU).height else 0
	a.sideType = if p then SlideOn.sideTypeOf(f, p, s) else "Rounded"
	a.edgeRadius = if p then p.radius else 0
	a.remaining = if p then SlideController.partEnd(f, p.part) - a.contactU else 0
	a.maxHeight = SlideOnConfig.maxReachableHeight(cfg, 1, S.MaxNoseLift, a.sideType, a.speed, math.max(a.turnIn, S.MinAngle))
	local block = ""
	if toward == 0 then
		block = "front"
	elseif a.toStart > S.TrackRange then
		block = "range"
	elseif a.turnIn < S.MinAngle or a.turnIn > S.MaxAngle then
		block = "angle"
	elseif a.sideGap < S.MinLateral or a.sideGap > S.MaxLateral then
		block = "distance"
	elseif not p then
		block = "noTop"
	elseif a.sideType == "Wall" or (f.def.sideWall or 0) > S.WallBlock then
		block = "wall"
	elseif a.topHeight > a.maxHeight then
		block = "height"
	elseif a.remaining < S.MinRemaining then
		block = "end"
	end
	a.slideOnBlock = block
end

return SlideOn
