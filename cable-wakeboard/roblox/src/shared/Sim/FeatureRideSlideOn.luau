-- Twin of src/sim/featureRide/slideOn.ts (slide-on, side approaches spec):
-- reading the approach (turn-in, inward speed, contact point, edge type,
-- availability), then the nose lift in the air, the lead crossing the side
-- edge and the contact phase (the board climbing on).
local Config = require(script.Parent.Config)
local DetMath = require(script.Parent.DetMath)
local Edge = require(script.Parent.Edge)
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

-- Blocks that still leave a side entry to try (v2 spec 2: the cue may be off,
-- the physics decides): any turn-in, too high, too near the end.
local function tryable(a)
	local b = a.slideOnBlock
	return b == "" or b == "height" or b == "end" or b == "angle"
end

local function featureOf(s, id)
	for _, f in s.features do
		if f.def.id == id then
			return f
		end
	end
	return nil
end

-- Edge load at the pop (v2 spec 1.1): the edge (0..1) if it carves toward the
-- feature, times the rope tension over EdgeTensionRef (clamped).
function SlideOn.edgeLoadAt(s)
	local r, cfg = s.rider, s.cfg
	local S = cfg.slideOn
	local a = r.approach
	if not a or a.side == "front" then
		return 0
	end
	local f = featureOf(s, a.featureId)
	if not f then
		return 0
	end
	-- World side the edge carves toward (+1 right of travel), and the feature's side.
	local carve = -Edge.toeSign(r) * Scalar.sign(r.edgeAngle)
	local featureRight = if Features.toLocal(f, r.pos).v < f.shape.vMin then 1 else -1
	local travelRight = if Vec.dot(Vec.rightOf(r.heading), Vec.rightOf(f.heading)) >= 0 then featureRight else -featureRight
	if carve == 0 or carve ~= travelRight then
		return 0
	end
	local edge = math.min(1, math.abs(r.edgeAngle) / cfg.edge.maxEdgeAngle)
	return edge * Scalar.clamp(r.ropeTension / S.EdgeTensionRef, S.EdgeTensionMin, S.EdgeTensionMax)
end

-- The water pop beside a feature (v2 spec 1.1): the side-entry height plus the
-- edge's pop bonus, the edge's release inward; a slide-on when near enough.
function SlideOn.predictSlideOn(s, air, popSpeed, edgeLoad)
	local r, cfg = s.rider, s.cfg
	local S = cfg.slideOn
	local load = edgeLoad or 0
	local a = r.approach
	if not a or a.side == "front" then
		return false
	end
	if a.inwardSpeed + S.EdgeReleaseBonus * load <= 0.05 then
		return false
	end
	local f = featureOf(s, a.featureId)
	if not f then
		return false
	end
	local l = Features.toLocal(f, r.pos)
	local toward = if l.v < f.shape.vMin then 1 else -1
	local push = Vec.scale(Vec.rightOf(f.heading), toward * S.EdgeReleaseBonus * load)
	r.vel = Vec.vec3(r.vel.x + push.x, r.vel.y - popSpeed * (1 - S.SidePopScale) + S.EdgePopBonus * load, r.vel.z + push.z)
	if not tryable(a) then
		return false
	end
	air.slideOn = {
		featureId = f.def.id,
		featureHeading = f.heading,
		toward = toward,
		target = S.AutoNoseLift,
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
		scrape = 0,
		edgeLoad = load,
	}
	return true
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

function SlideOn.edgeLeads(yaw, cfg)
	return math.abs(sin(yaw)) > sin(cfg.slideOn.EdgeLeadAngle)
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
	local edge = SlideOn.edgeLeads(yaw, cfg)
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
	if low >= top + cfg.featureRide.Entry.Clearance then
		so.phase = "cleared"
		return "cleared"
	end
	local tol = S.NoseTolerance[kind]
	-- How far the nose is under its tolerance (0 when it is within it).
	local under = math.max(0, top - tol - lead)
	local vin = math.max(0, so.toward * Vec.dot(r.vel, Vec.rightOf(f.heading)))
	-- Just popped and rising fast, the board still rides up the face: only a board that cannot climb it digs in.
	local vyUp = math.max(0, r.vel.y)
	local energy = 0.5 * vyUp * vyUp + 0.5 * vin * vin * S.ClimbEfficiency
	if under > S.ScrapeBand and energy < GRAVITY * (top - r.pos.y) and kind ~= "Bank" then
		return "noseDig"
	end
	so.phase = "contact"
	so.scrape = under
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
	local ropeIn = (S.RopeAssistScale * so.toward * Vec.dot(r.ropeForce, Vec.rightOf(f.heading))) / m
	-- The board's sideways extent (at least a tenth of it), plus a bank's run from the foot to the flat top.
	local length = (if so.lead == "edge" then S.BaseWidth else S.BoardLength * math.max(math.abs(sin(so.yaw0)), 0.1)) + so.bankRun
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
		if v2 <= S.HangUpSpeed * S.HangUpSpeed then
			so.vin = math.sqrt(math.max(0, v2))
			-- Close to the top the legs finish the climb.
			if so.top - Scalar.lerp(so.y0, so.top, so.p) <= S.HangUpDrop then
				so.p = 1
				break
			end
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

-- Coyote time (v2 spec 2): charging beside a feature, the nose has reached its side edge on the water.
function SlideOn.coyoteContact(s)
	local r, cfg = s.rider, s.cfg
	local a = r.approach
	if not a or a.side == "front" or not tryable(a) or a.inwardSpeed <= 0 then
		return false
	end
	return a.sideGap <= (cfg.slideOn.BoardLength / 2) * math.abs(sin(a.turnIn)) + 0.05
end

-- A side approach is on (v2 spec 1): beside a feature, moving or carving toward it (no water trick arms).
function SlideOn.sideApproachOn(s)
	local a = s.rider.approach
	if not a or a.side == "front" then
		return false
	end
	return a.inwardSpeed > 0.05 or SlideOn.edgeLoadAt(s) > 0
end

-- Beside a feature within reach (v2 spec 2): W at the pop lifts the nose, it never flips.
function SlideOn.besideFeature(s)
	local a = s.rider.approach
	return a ~= nil and a.side ~= "front" and a.sideGap <= s.cfg.slideOn.MaxLateral and a.toStart <= s.cfg.slideOn.TrackRange
end

return SlideOn
