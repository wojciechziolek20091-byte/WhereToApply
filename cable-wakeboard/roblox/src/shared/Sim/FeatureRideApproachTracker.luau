-- Twin of src/sim/featureRide/approachTracker.ts (ApproachTracker, feature
-- riding spec 3.1): how the rider is coming at the nearest feature.
local Config = require(script.Parent.Config)
local DetMath = require(script.Parent.DetMath)
local Edge = require(script.Parent.Edge)
local Features = require(script.Parent.Features)
local Scalar = require(script.Parent.Scalar)
local SlideOn = require(script.Parent.FeatureRideSlideOn)
local Vec = require(script.Parent.Vec)

local DT = Config.DT
local ApproachTracker = {}

-- edgeAge on an approach that never had a hard edge (s).
local NEVER = 99

function ApproachTracker.trackApproach(s)
	local r, cfg = s.rider, s.cfg
	local A = cfg.featureRide.Approach
	local best = nil
	local speed = Vec.horizontalLength(r.vel)
	local travel = if speed > 0.5 then Vec.headingOf(r.vel) else r.heading
	for _, f in s.features do
		local sh = f.shape
		local l = Features.toLocal(f, r.pos)
		if not (l.u < sh.uMin - A.Range or l.u > sh.uMax) then
			local gap = if l.v < sh.vMin then sh.vMin - l.v elseif l.v > sh.vMax then l.v - sh.vMax else 0
			if not (gap > A.LateralRange) then
				local toStart = sh.uMin - l.u
				local score = math.max(toStart, 0) + gap
				if not (best and score >= best.score) then
					local angle = Scalar.wrapAngle(travel - f.heading)
					local side = "front"
					local featureSide = 0
					if l.v < sh.vMin - A.FrontMargin or l.v > sh.vMax + A.FrontMargin then
						featureSide = (if l.v < sh.vMin then 1 else -1) * (if DetMath.cos(angle) >= 0 then 1 else -1)
						side = if featureSide == Edge.toeSign(r) then "toeside" else "heelside"
					end
					best = {
						score = score,
						f = f,
						l = l,
						state = {
							featureId = f.def.id,
							toStart = toStart,
							lateral = l.v - (sh.vMin + sh.vMax) / 2,
							sideGap = gap,
							angle = angle,
							side = side,
							edge = Edge.edgeNorm(r, cfg.edge) * (if r.edgeAngle >= 0 then 1 else -1),
							edgeTime = 0,
							edgeAge = 0,
							featureSide = featureSide,
							inwardSpeed = 0,
							turnIn = 0,
							contactU = 0,
							topHeight = 0,
							sideType = "Rounded",
							edgeRadius = 0,
							remaining = 0,
							maxHeight = 0,
							slideOnBlock = "front",
							speed = speed,
							tension = r.ropeTension,
							ropeAngle = Scalar.wrapAngle(r.ropeHeading - f.heading),
						},
					}
				end
			end
		end
	end
	if not best then
		r.approach = nil
		return
	end
	local a = best.state
	local same = if r.approach and r.approach.featureId == a.featureId then r.approach else nil
	local hard = math.abs(a.edge) >= A.HardEdge
	a.edgeTime = if hard then (if same then same.edgeTime else 0) + DT else 0
	a.edgeAge = if hard then 0 else (if same then same.edgeAge else NEVER) + DT
	-- Can the board slide on from here (side approaches spec 3)?
	SlideOn.assessSlideOn(s, best.f, best.l, a)
	r.approach = a
end

return ApproachTracker
