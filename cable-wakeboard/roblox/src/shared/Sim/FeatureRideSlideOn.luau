-- Twin of src/sim/featureRide/slideOn.ts (slide-on, side approaches spec):
-- reading the approach (turn-in, inward speed, contact point, edge type,
-- availability), then the nose lift in the air, the lead crossing the side
-- edge and the contact phase (the board climbing on).
local Config = require(script.Parent.Config)
local DetMath = require(script.Parent.DetMath)
local EntryResolver = require(script.Parent.FeatureRideEntryResolver)
local Features = require(script.Parent.Features)
local FeatureShapes = require(script.Parent.FeatureShapes)
local Scalar = require(script.Parent.Scalar)
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
		if q.cap then
			return "Bank"
		end
	end
	if p.width < s.cfg.slideOn.RailMaxWidth then
		return "Rail"
	end
	return "Rounded"
end

function SlideOn.topPieceAt(f, u, v)
	v = v or 0
	local best, bestOff = nil, math.huge
	for _, p in f.shape.pieces do
		if p.slide and p.axis == "u" and not p.wall and u >= p.u0 and u <= p.u1 then
			local off = math.abs(v - FeatureShapes.pieceCentre(p, u))
			if off < bestOff then
				best, bestOff = p, off
			end
		end
	end
	return best
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
	local edge = SlideOn.topPieceAt(f, a.contactU, l.v)
	a.sideType = if edge then SlideOn.sideTypeOf(f, edge, s) else "Rounded"
	a.edgeRadius = if edge then edge.radius else 0
	local p = edge
	if edge and edge.cap and toward ~= 0 and inward > 0.05 then
		-- A bank: the board reaches the flat top only after climbing its run.
		a.contactU += (along * (edge.cap.half - edge.cap.halfTop)) / inward
		p = SlideOn.topPieceAt(f, a.contactU, l.v)
	end
	a.topHeight = if p then FeatureShapes.pieceHeightAt(p, a.contactU).height else 0
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

local DT, GRAVITY = Config.DT, Config.GRAVITY
local sin, cos = DetMath.sin, DetMath.cos

local function tryable(a, cfg)
	local b = a.slideOnBlock
	return b == "" or b == "height" or b == "end" or (b == "angle" and a.turnIn > cfg.slideOn.MaxAngle)
end

local function featureOf(s, id)
	for _, f in s.features do
		if f.def.id == id then
			return f
		end
	end
	return nil
end

function SlideOn.predictSlideOn(s, air, popSpeed)
	local r, cfg = s.rider, s.cfg
	local a = r.approach
	if not a or not tryable(a, cfg) or a.inwardSpeed <= 0 then
		return
	end
	local f = featureOf(s, a.featureId)
	if not f then
		return
	end
	r.vel = Vec.vec3(r.vel.x, r.vel.y - popSpeed * (1 - cfg.slideOn.SidePopScale), r.vel.z)
	local l = Features.toLocal(f, r.pos)
	air.slideOn = {
		featureId = f.def.id,
		featureHeading = f.heading,
		toward = if l.v < f.shape.vMin then 1 else -1,
		target = cfg.slideOn.AutoNoseLift,
		pitch = 0,
		sinceRelease = 0,
		phase = "air",
		lead = "nose",
		p = 0,
		vin = 0,
		vin0 = 0,
		vy = 0,
		y0 = 0,
		top = 0,
		type = a.sideType,
		yaw0 = 0,
		u = 0,
		v = 0,
		along = 0,
		part = 0,
		bankRun = 0,
	}
end

function SlideOn.stepNoseLift(s, air, input)
	local so = air.slideOn
	if not so or so.phase ~= "air" then
		return
	end
	local S = s.cfg.slideOn
	so.sinceRelease += DT
	if input.forward and so.sinceRelease <= S.WWindow then
		so.target = S.MaxNoseLift
	end
	so.pitch = Scalar.approach(so.pitch, so.target, (S.MaxNoseLift / S.NoseLiftTime) * DT)
end

local function yawToAxis(air, f)
	return Scalar.wrapAngle(EntryResolver.boardYawInAir(air) - f.heading)
end

function SlideOn.edgeLeads(yaw)
	return math.abs(sin(yaw)) > sin(math.pi / 4)
end

function SlideOn.leadCrossing(s, air)
	local r, cfg = s.rider, s.cfg
	local S = cfg.slideOn
	local so = air.slideOn
	if not so or so.phase ~= "air" then
		return nil
	end
	local f = featureOf(s, so.featureId)
	if not f then
		return nil
	end
	local l = Features.toLocal(f, r.pos)
	local yaw = yawToAxis(air, f)
	local edge = SlideOn.edgeLeads(yaw)
	local reach = if edge then S.BaseWidth / 2 else (S.BoardLength / 2) * math.abs(sin(yaw))
	local leadU = if edge then l.u else l.u + (S.BoardLength / 2) * math.abs(cos(yaw))
	local leadV = l.v + so.toward * reach
	local p = SlideOn.topPieceAt(f, leadU, leadV)
	if not p then
		return nil
	end
	local edgeV = FeatureShapes.pieceCentre(p, leadU) - so.toward * (p.width / 2)
	if so.toward * (leadV - edgeV) < 0 then
		return nil
	end
	local top = FeatureShapes.pieceHeightAt(p, leadU).height
	local half = if edge then S.BaseWidth / 2 else S.BoardLength / 2
	local lift = half * sin(so.pitch)
	local lead = r.pos.y + lift
	local low = r.pos.y - lift
	local kind = SlideOn.sideTypeOf(f, p, s)
	so.type = kind
	so.lead = if edge then "edge" else "nose"
	so.part = p.part
	so.bankRun = if p.cap then p.cap.half - p.cap.halfTop else 0
	local offAxis = if edge
		then math.abs(math.abs(yaw) - math.pi / 2)
		else math.min(math.abs(yaw), math.pi - math.abs(yaw))
	if not edge and offAxis > S.HeadOnAngle and kind ~= "Bank" then
		return "noseDig"
	end
	if low >= top + cfg.featureRide.Entry.Clearance then
		so.phase = "cleared"
		return "cleared"
	end
	if kind == "Rail" then
		if lead < top + SlideOnConfig.noseClearance(kind, cfg) then
			return "noseDig"
		end
		if r.pos.y >= top - S.RailCentreAllowance then
			so.phase = "cleared"
			return "cleared"
		end
		-- Still rising: wait, unless the board's middle has reached the rail low (its base hits it).
		local centre = FeatureShapes.pieceCentre(p, leadU)
		if r.vel.y > 0 and so.toward * (l.v - centre) < 0 then
			return nil
		end
		return "hangUp"
	end
	if lead < top + SlideOnConfig.noseClearance(kind, cfg) and kind ~= "Bank" then
		return "noseDig"
	end
	so.phase = "contact"
	so.p = 0
	so.vin = math.max(0, so.toward * Vec.dot(r.vel, Vec.rightOf(f.heading)))
	so.vin0 = so.vin
	so.vy = math.max(0, r.vel.y)
	so.y0 = r.pos.y
	so.top = top
	so.yaw0 = yaw
	so.u = l.u
	so.v = l.v
	so.along = Vec.dot(r.vel, Vec.forwardOf(f.heading))
	return "contact"
end

function SlideOn.stepContact(s, air)
	local r, cfg = s.rider, s.cfg
	local S = cfg.slideOn
	local so = air.slideOn
	local f = featureOf(s, so.featureId)
	local n = S.SubSteps
	local dt = DT / n
	local m = cfg.rider.mass
	local ropeIn = (so.toward * Vec.dot(r.ropeForce, Vec.rightOf(f.heading))) / m
	-- A bank adds its run from the foot to the flat top.
	local length = (if so.lead == "edge" then S.BaseWidth else S.BoardLength * math.max(math.abs(sin(so.yaw0)), sin(S.MinAngle))) + so.bankRun
	local climbTo = so.top - (if so.type == "Round" then S.RoundTailAllowance else 0)
	for _ = 1, n do
		local dp = math.min(1 - so.p, (so.vin * dt) / length)
		local work = GRAVITY * math.max(0, climbTo - so.y0) * dp + S.EdgeFriction[so.type] * dp - ropeIn * so.vin * dt
		local ev = 0.5 * so.vy * so.vy
		local take = math.min(ev, math.max(work, 0))
		so.vy = math.sqrt(2 * (ev - take))
		work -= take
		local v2 = so.vin * so.vin - (2 * work) / S.ClimbEfficiency
		so.u += so.along * dt
		if v2 <= 0 then
			so.vin = 0
			return "hang"
		end
		so.vin = math.sqrt(v2)
		so.v += so.toward * so.vin * dt
		so.p += dp
		if so.p >= 1 then
			so.p = 1
			break
		end
	end
	so.pitch = Scalar.lerp(so.target, 0, so.p)
	local y = Scalar.lerp(so.y0, so.top, so.p)
	local fwd = Vec.forwardOf(f.heading)
	local right = Vec.rightOf(f.heading)
	local o = f.origin
	r.pos = Vec.vec3(o.x + fwd.x * so.u + right.x * so.v, y, o.z + fwd.z * so.u + right.z * so.v)
	r.vel = Vec.vec3(fwd.x * so.along + right.x * so.toward * so.vin, 0, fwd.z * so.along + right.z * so.toward * so.vin)
	return if so.p >= 1 then "done" else nil
end

return SlideOn
