-- Riding kickers and sliders, jib balance, landing on features.
-- Mirrors src/sim/onFeature.ts.
local DetMath = require(script.Parent.DetMath)
local Actions = require(script.Parent.Actions)
local Config = require(script.Parent.Config)
local Edge = require(script.Parent.Edge)
local Features = require(script.Parent.Features)
local Landing = require(script.Parent.Landing)
local Pop = require(script.Parent.Pop)
local Posture = require(script.Parent.Posture)
local Scalar = require(script.Parent.Scalar)
local Vec = require(script.Parent.Vec)

local DT, GRAVITY = Config.DT, Config.GRAVITY
local OnFeature = {}

local function featureById(s, id)
	for _, f in s.features do
		if f.def.id == id then
			return f
		end
	end
	error(`unknown feature {id}`)
end

-- Ride onto a feature (from the start, roughly aligned, low surface) or crash into it.
function OnFeature.tryEnterFeature(s)
	local r = s.rider
	local hit = Features.featureUnder(s.features, r.pos)
	if not hit then
		return false
	end
	local feature, l, surface = hit.feature, hit["local"], hit.surface
	local speed = Vec.horizontalLength(r.vel)
	local along = if speed > 0.1 then Vec.dot(Vec.horizontal(r.vel), Vec.forwardOf(feature.heading)) / speed else 0
	if surface.height > s.cfg.feature.mountHeight or along < DetMath.cos(s.cfg.feature.mountAngle) then
		Actions.fallRider(s, "featureCrash")
		return true
	end
	r.ramp = {
		featureId = feature.def.id,
		u = l.u,
		v = l.v,
		edgeAngleAtBase = r.edgeAngle,
		releaseTick = -1,
		pendingPop = nil,
	}
	-- Snapshot the edge load at the base: this is what the pop draws on.
	r.load.edgeLoadAtBase = math.max(r.edgeLoad, r.load.peakEdgeLoad)
	Actions.setMode(s, "feature")
	table.insert(s.events, { type = "featureEnter", tick = s.tick, featureId = feature.def.id })
	return true
end

local function startJib(feature, boardYaw)
	return {
		featureId = feature.def.id,
		balance = 0,
		boardAngle = Scalar.wrapHalfTurn(boardYaw - feature.heading),
		time = 0,
		alignedTime = 0,
		crossedTime = 0,
	}
end

local function endJib(s)
	local j = s.rider.jib
	if not j then
		return
	end
	table.insert(s.events, {
		type = "jibDone",
		tick = s.tick,
		featureId = j.featureId,
		time = j.time,
		alignedTime = j.alignedTime,
		crossedTime = j.crossedTime,
	})
	s.rider.jib = nil
end

-- Balance on a box or rail. Returns false on a fall.
function OnFeature.updateJib(r, j, input, ropeLat, halfWidth, cfg)
	local jc = cfg.jib
	local target = if input.spin ~= 0 then Scalar.sign(input.spin) * (math.pi / 2) else 0
	j.boardAngle = Scalar.approach(j.boardAngle, target, jc.boardRotateRate * DT)
	local lateral = (if r.ramp then r.ramp.v else 0) / (halfWidth + 0.15)
	local offStable = DetMath.sin(2 * j.boardAngle)
	local lean = -Edge.toeSign(r) * input.edge
	local dBalance = jc.drift * lateral + jc.angleDrift * offStable + ropeLat / jc.ropeTip - jc.correction * lean
	j.balance += dBalance * DT
	j.time += DT
	if math.abs(j.boardAngle) < 0.35 then
		j.alignedTime += DT
	elseif math.abs(j.boardAngle) > 1.2 then
		j.crossedTime += DT
	end
	return math.abs(j.balance) <= 1
end

-- Leave the feature into the air with whatever pop is pending.
local function leaveFeature(s, f, input)
	local r = s.rider
	local pop = if r.ramp then r.ramp.pendingPop else nil
	endJib(s)
	table.insert(s.events, { type = "featureExit", tick = s.tick, featureId = f.def.id })
	Actions.takeOff(
		s,
		if f.def.kind == "kicker" then "kicker" else "slider",
		f.def.id,
		if pop then pop.speed else 0,
		if pop then pop.quality else 0,
		r.load.edgeLoadAtBase,
		input
	)
end

-- One tick on a kicker ramp or slider.
function OnFeature.stepFeature(s, input)
	local r, cfg = s.rider, s.cfg
	local ramp = r.ramp
	assert(ramp, "feature mode without RampState")
	local f = featureById(s, ramp.featureId)
	local m = cfg.rider.mass
	local released = Actions.popReleased(s, input)
	local compression = r.legCompression
	Posture.updatePosture(r, input.handleIn, input.load, r.ropeTension, cfg.posture, DT)
	if not r.jib then
		Edge.updateEdge(r, if r.hasHandle then input.edge else 0, cfg.edge, DT)
	end
	local rope = Actions.applyRope(s)

	local surface = Features.surfaceAt(f, { u = ramp.u, v = ramp.v })
	if not surface then
		leaveFeature(s, f, input)
		return
	end
	local t = surface.tangent
	local n = surface.normal
	local right = Vec.rightOf(f.heading)
	local vt = Vec.dot(r.vel, t)
	local vl = Vec.dot(r.vel, right)
	local normalForce = math.max(0, m * GRAVITY * n.y - Vec.dot(rope.force, n))
	local mu = if f.def.kind == "slider" and surface.onTop then cfg.jib.friction else cfg.feature.rampFriction
	local at = (Vec.dot(rope.force, t) - m * GRAVITY * t.y - mu * normalForce * Scalar.sign(vt)) / m
	vt += at * DT
	local ropeLat = Vec.dot(rope.force, right)

	if r.jib then
		vl += (ropeLat / m - cfg.jib.lateralDamping * vl) * DT
		r.edgeLoad = 0
	else
		local grip = cfg.hydro.lateralGrip * (cfg.hydro.flatGripFraction + (1 - cfg.hydro.flatGripFraction) * Edge.edgeNorm(r, cfg.edge))
		local latForce = -grip * vl * math.max(math.abs(vt), cfg.hydro.gripMinSpeed)
		vl += ((ropeLat + latForce) / m) * DT
		r.edgeLoad = math.abs(latForce)
	end

	if vt < cfg.feature.stallSpeed then
		Actions.fallRider(s, "featureCrash")
		return
	end

	-- Release on the feature: on a kicker the pop waits for the lip; on a
	-- slider the rider ollies off straight away.
	if released and ramp.releaseTick < 0 then
		ramp.releaseTick = s.tick
		if f.def.kind == "kicker" then
			local horizontalSpeed = math.max(vt * Vec.dot(t, Vec.forwardOf(f.heading)), 0.5)
			local timeToLip = (f.def.length - ramp.u) / horizontalSpeed
			ramp.pendingPop = Pop.computePop({
				edgeLoadAtBase = r.load.edgeLoadAtBase,
				holdRatio = Scalar.clamp01(math.abs(r.edgeAngle) / math.max(math.abs(ramp.edgeAngleAtBase), 0.05)),
				tensionAtRelease = rope.tension,
				timing = Pop.popTimingFactor(timeToLip, cfg.pop),
				connection = r.connection,
				compression = compression,
			}, cfg.pop)
		else
			local pop = Pop.computePop(Pop.flatPopInputs(r.load, r.edgeLoad, rope.tension, r.connection, compression, cfg.pop), cfg.pop)
			ramp.pendingPop = { speed = pop.speed * 0.6, quality = pop.quality * 0.6 }
			leaveFeature(s, f, input)
			return
		end
	end

	ramp.u += vt * Vec.dot(t, Vec.forwardOf(f.heading)) * DT
	ramp.v += vl * DT
	r.loadHeld = input.load

	local nxt = Features.surfaceAt(f, { u = ramp.u, v = ramp.v })
	if not nxt then
		-- Off the lip, off the end, or off the side: momentum carries on.
		r.vel = Vec.add(Vec.scale(t, vt), Vec.scale(right, vl))
		r.pos = Features.toWorld(f, ramp.u, ramp.v, surface.height)
		leaveFeature(s, f, input)
		return
	end
	r.pos = Features.toWorld(f, ramp.u, ramp.v, nxt.height)
	r.vel = Vec.add(Vec.scale(nxt.tangent, vt), Vec.scale(right, vl))
	r.heading = f.heading

	if f.def.kind == "slider" and nxt.onTop then
		if not r.jib then
			r.jib = startJib(f, r.heading)
		end
		if not OnFeature.updateJib(r, r.jib, input, ropeLat, f.def.width / 2, cfg) then
			endJib(s)
			Actions.fallRider(s, "featureCrash")
		end
	end
end

-- Airborne touchdown on a feature. Returns true if a feature handled it.
function OnFeature.touchDownOnFeature(s, air)
	local r = s.rider
	local hit = Features.featureUnder(s.features, r.pos)
	if not hit or r.pos.y > hit.surface.height or r.vel.y >= 0 then
		return false
	end
	local feature, l, surface = hit.feature, hit["local"], hit.surface
	if feature.def.kind ~= "slider" or not surface.onTop then
		Actions.fallRider(s, "featureCrash")
		return true
	end
	local yaw = Scalar.wrapHalfTurn(r.heading + air.spinAngle - feature.heading)
	local nearStable = math.min(math.abs(yaw), math.abs(math.abs(yaw) - math.pi / 2)) < 0.5
	local flatAir = table.clone(air)
	flatAir.spinAngle = 0
	local landing = Landing.evaluateLanding(r, flatAir, surface.normal, s.cfg)
	if not nearStable or landing.fall then
		Actions.fallRider(s, landing.fall or "featureCrash", landing)
		return true
	end
	if math.fmod(math.abs(Scalar.round(air.spinAngle / math.pi)), 2) == 1 then
		r.switchStance = not r.switchStance
	end
	r.pos = Features.toWorld(feature, l.u, l.v, surface.height)
	r.vel = Vec.scale(surface.tangent, math.max(Vec.dot(r.vel, surface.tangent), s.cfg.feature.stallSpeed + 0.5))
	r.heading = feature.heading
	r.air = nil
	r.ramp = {
		featureId = feature.def.id,
		u = l.u,
		v = l.v,
		edgeAngleAtBase = 0,
		releaseTick = -1,
		pendingPop = nil,
	}
	r.jib = startJib(feature, feature.heading + Scalar.wrapAngle(yaw))
	Actions.setMode(s, "feature")
	table.insert(s.events, { type = "landed", tick = s.tick, air = air, landing = landing })
	table.insert(s.events, { type = "featureEnter", tick = s.tick, featureId = feature.def.id })
	return true
end

return OnFeature
