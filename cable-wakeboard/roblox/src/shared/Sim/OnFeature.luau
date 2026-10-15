-- Kickers and obstacles: kicker ramp and lip pop, the safety and its pop window,
-- sliding the main (90-degree steps, balance, handle passes), landing on a main.
-- Mirrors src/sim/onFeature.ts.
local Actions = require(script.Parent.Actions)
local Config = require(script.Parent.Config)
local DetMath = require(script.Parent.DetMath)
local Edge = require(script.Parent.Edge)
local Features = require(script.Parent.Features)
local Fsm = require(script.Parent.Fsm)
local Handle = require(script.Parent.Handle)
local Landing = require(script.Parent.Landing)
local Noise = require(script.Parent.Noise)
local Pop = require(script.Parent.Pop)
local Posture = require(script.Parent.Posture)
local Rotation = require(script.Parent.Rotation)
local Scalar = require(script.Parent.Scalar)
local Vec = require(script.Parent.Vec)

local DT, GRAVITY = Config.DT, Config.GRAVITY
local OnFeature = {}

local function deg(d)
	return (d * math.pi) / 180
end

local function featureById(s, id)
	for _, f in s.features do
		if f.def.id == id then
			return f
		end
	end
	error(`unknown feature {id}`)
end

function OnFeature.safetyWindow(def, cfg)
	local len = math.max(def.entryLength * cfg.safety.popWindowFraction, cfg.safety.popWindowMinMetres)
	return { start = math.max(0, def.entryLength - len), ["end"] = def.entryLength }
end

function OnFeature.tryEnterFeature(s)
	local r = s.rider
	local hit = Features.featureUnder(s.features, r.pos)
	if not hit then
		return false
	end
	local feature, l, surface = hit.feature, hit["local"], hit.surface
	local speed = Vec.horizontalLength(r.vel)
	local along = if speed > 0.1 then Vec.dot(Vec.horizontal(r.vel), Vec.forwardOf(feature.heading)) / speed else 0
	if r.mode == "ridingBlind" or surface.height > s.cfg.feature.mountHeight or along < DetMath.cos(s.cfg.feature.mountAngle) then
		Actions.crash(s, "hitFeature")
		return true
	end
	r.ramp = { featureId = feature.def.id, u = l.u, v = l.v, releaseTick = -1, releaseTimeToLip = -1, sketchy = false }
	Fsm.transition(s, if feature.def.kind == "kicker" then "onKicker" else "onSafety", "rideOn")
	table.insert(s.events, { type = "featureEnter", tick = s.tick, featureId = feature.def.id })
	return true
end

local function startJib(s, feature, boardAngle, entry, sketchy)
	local rot = Rotation.createRotation(s.cfg.handlePass.featureWindow)
	return {
		featureId = feature.def.id,
		balance = 0,
		boardAngle = boardAngle,
		targetAngle = boardAngle,
		entryAngle = boardAngle,
		time = 0,
		slideTimes = { fiftyFifty = 0, switchFiftyFifty = 0, backboard = 0, frontboard = 0 },
		slideOrder = {},
		entry = entry,
		sketchy = sketchy,
		rot = rot,
		noiseSeed = s.tick,
	}
end

function OnFeature.slideIdAt(boardAngle, featureHeading, travelHeading, r)
	local k = Scalar.round(boardAngle / (math.pi / 2))
	local m = Scalar.mod(k, 4)
	if m == 0 then
		return if r.switchStance then "switchFiftyFifty" else "fiftyFifty"
	end
	if m == 2 then
		return if r.switchStance then "fiftyFifty" else "switchFiftyFifty"
	end
	local chest = featureHeading + boardAngle + (Edge.toeSign(r) * math.pi) / 2
	return if DetMath.cos(chest - travelHeading) > 0 then "backboard" else "frontboard"
end

local function endSlide(s)
	local j = s.rider.jib
	if not j then
		return
	end
	table.insert(s.events, { type = "slideDone", tick = s.tick, jib = j })
end

local function leaveFeature(s, f, popSpeed, popQuality)
	local r = s.rider
	local spinStart = if r.jib then Scalar.wrapAngle(r.jib.boardAngle) else 0
	local keepHandle = r.handle
	endSlide(s)
	table.insert(s.events, { type = "featureExit", tick = s.tick, featureId = f.def.id })
	local onMain = false
	if r.ramp then
		local surf = Features.surfaceAt(f, { u = r.ramp.u, v = r.ramp.v })
		onMain = surf ~= nil and surf.onTop
	end
	local air = Actions.takeOff(s, if f.def.kind == "kicker" then "kicker" else "feature", f.def.id, popSpeed, popQuality, spinStart)
	air.overFeature = f.def.id .. ":" .. (if onMain then "main" else "ramp")
	r.handle = if keepHandle == "passing" then "inFront" else keepHandle
	return air
end

-- Get onto the main of a box or rail.
local function mountMain(s, f, u, v, speed, entry, sketchy, boardAngle)
	boardAngle = boardAngle or 0
	local r = s.rider
	local top = Features.surfaceAt(f, { u = math.max(u, f.def.entryLength), v = v })
	local height = if top then top.height else f.def.height
	r.ramp = { featureId = f.def.id, u = math.max(u, f.def.entryLength), v = v, releaseTick = -1, releaseTimeToLip = -1, sketchy = sketchy }
	r.pos = Features.toWorld(f, r.ramp.u, v, height)
	r.vel = Vec.scale(Vec.forwardOf(f.heading), math.max(speed, s.cfg.feature.stallSpeed + 0.5))
	r.heading = f.heading
	r.jib = startJib(s, f, boardAngle, entry, sketchy)
	r.popCharge = 0
	Fsm.transition(s, "onFeature", entry)
end

-- One tick on a kicker ramp or a safety.
function OnFeature.stepRamp(s, input, mem)
	local r, cfg = s.rider, s.cfg
	local ramp = r.ramp
	if not ramp then
		error("ramp mode without RampState")
	end
	local f = featureById(s, ramp.featureId)
	local m = cfg.rider.mass
	Posture.updatePosture(r, if input.armsOut then 0 else 1, input.pop, r.ropeTension, cfg.posture, DT)
	Edge.updateEdge(r, 0, cfg.edge, DT)
	local rope = Actions.applyRope(s)
	if not rope then
		return
	end

	local surface = Features.surfaceAt(f, { u = ramp.u, v = ramp.v })
	if not surface then
		leaveFeature(s, f, 0, 0)
		return
	end
	local t = surface.tangent
	local n = surface.normal
	local right = Vec.rightOf(f.heading)
	local vt = Vec.dot(r.vel, t)
	local vl = Vec.dot(r.vel, right)
	local normalForce = math.max(0, m * GRAVITY * n.y - Vec.dot(rope.force, n))
	local at = (Vec.dot(rope.force, t) - m * GRAVITY * t.y - cfg.feature.rampFriction * normalForce * Scalar.sign(vt)) / m
	vt += at * DT
	local ropeLat = Vec.dot(rope.force, right)
	local grip = cfg.hydro.lateralGrip * (cfg.hydro.flatGripFraction + (1 - cfg.hydro.flatGripFraction) * Edge.edgeNorm(r, cfg.edge))
	vl += ((ropeLat - grip * vl * math.max(math.abs(vt), cfg.hydro.gripMinSpeed)) / m) * DT
	r.edgeLoad = 0
	if vt < cfg.feature.stallSpeed then
		Actions.crash(s, "hitFeature")
		return
	end
	local horizontalSpeed = math.max(vt * Vec.dot(t, Vec.forwardOf(f.heading)), 0.5)

	if mem.popPressed or input.pop then
		r.popCharge = Pop.ollieCharge(mem.popHeldTime, cfg)
	end
	if mem.popReleased and ramp.releaseTick < 0 then
		ramp.releaseTick = s.tick
		if f.def.kind == "kicker" then
			ramp.releaseTimeToLip = (f.def.length - ramp.u) / horizontalSpeed
		else
			local w = OnFeature.safetyWindow(f.def, cfg)
			if ramp.u >= w.start then
				local centre = (w.start + w["end"]) / 2
				local perfect = math.abs(ramp.u - centre) <= (cfg.safety.perfectFraction * (w["end"] - w.start)) / 2
				mountMain(s, f, ramp.u, ramp.v, vt, if perfect then "popOn" else "pop", ramp.sketchy)
				return
			end
			if f.def.safety == "gap" then
				Actions.crash(s, "missedSafetyPop")
				return
			end
			ramp.sketchy = true
		end
	end

	ramp.u += vt * Vec.dot(t, Vec.forwardOf(f.heading)) * DT
	ramp.v += vl * DT
	local nextSurface = Features.surfaceAt(f, { u = ramp.u, v = ramp.v })
	if f.def.kind == "slider" and nextSurface and nextSurface.onTop then
		if f.def.safety == "gap" then
			Actions.crash(s, "missedSafetyPop")
			return
		end
		mountMain(s, f, ramp.u, ramp.v, vt, "rideOn", ramp.sketchy)
		return
	end
	if not nextSurface then
		r.vel = Vec.add(Vec.scale(t, vt), Vec.scale(right, vl))
		r.pos = Features.toWorld(f, ramp.u, ramp.v, surface.height)
		local popSpeed = 0
		local quality = 0
		local lipPop = f.def.kind == "kicker" and ramp.releaseTimeToLip >= 0 and ramp.releaseTimeToLip <= cfg.kicker.lipPopWindow
		if lipPop and r.vel.y > 0 then
			popSpeed = r.vel.y * cfg.kicker.lipPopBonus
			quality = 1 - ramp.releaseTimeToLip / cfg.kicker.lipPopWindow
		end
		local air = leaveFeature(s, f, popSpeed, quality)
		air.lipPop = lipPop
		return
	end
	r.pos = Features.toWorld(f, ramp.u, ramp.v, nextSurface.height)
	r.vel = Vec.add(Vec.scale(nextSurface.tangent, vt), Vec.scale(right, vl))
	r.heading = f.heading
end

-- One tick sliding the main of a box or rail.
function OnFeature.stepSlide(s, input, mem)
	local r, cfg = s.rider, s.cfg
	local ramp = r.ramp
	local j = r.jib
	if not ramp or not j then
		error("onFeature without RampState / JibState")
	end
	local f = featureById(s, ramp.featureId)
	local def = f.def
	local m = cfg.rider.mass
	Posture.updatePosture(r, if input.armsOut then 0 else 1, input.pop, r.ropeTension, cfg.posture, DT)
	local rope = Actions.applyRope(s)
	if not rope then
		return
	end
	local surface = Features.surfaceAt(f, { u = ramp.u, v = ramp.v })
	if not surface or not surface.onTop then
		leaveFeature(s, f, 0, 0)
		return
	end
	local t = surface.tangent
	local right = Vec.rightOf(f.heading)
	local vt = Vec.dot(r.vel, t)
	local vl = Vec.dot(r.vel, right)
	local at = (Vec.dot(rope.force, t) - cfg.feature.friction * m * GRAVITY * Scalar.sign(vt)) / m
	vt += at * DT
	local ropeLat = Vec.dot(rope.force, right)
	vl += (ropeLat / m - cfg.feature.lateralDamping * vl) * DT
	r.edgeLoad = 0
	if vt < cfg.feature.stallSpeed then
		endSlide(s)
		Actions.crash(s, "fellOffFeature")
		return
	end

	local stepRate = math.pi / 2 / cfg.feature.rotateTimePer90
	if j.boardAngle == j.targetAngle and mem.steerDir ~= 0 and mem.steerHeldTime >= cfg.feature.tapTime then
		local dir = mem.steerDir
		if j.rot.spinSide == nil then
			j.rot.spinSide = Rotation.rotationSide(dir, f.heading + j.boardAngle, Edge.toeSign(r), r.ropeHeading)
			j.rot.startDir = dir
		end
		j.rot.spinDir = dir
		j.targetAngle = j.boardAngle + (dir * math.pi) / 2
	end
	j.boardAngle = Scalar.approach(j.boardAngle, j.targetAngle, stepRate * DT)
	j.rot.spinAngle = j.boardAngle - j.entryAngle
	j.rot.maxSpin = math.max(j.rot.maxSpin, math.abs(j.rot.spinAngle))
	local handle, result = Handle.updateHandle(r.handle, j.rot, mem.passPressed, { rate = stepRate, inAir = false }, cfg, DT)
	r.handle = handle
	if result.passed then
		table.insert(s.events, { type = "handlePass", tick = s.tick })
	end
	if result.dropped then
		endSlide(s)
		Actions.crash(s, "handleDropped")
		return
	end

	if cfg.feature.balanceEnabled then
		local drift = if def.style == "box" then cfg.feature.balanceDriftBox else cfg.feature.balanceDriftRail
		local noise = Noise.valueNoise(j.time * cfg.feature.balanceNoiseRate, j.noiseSeed)
		j.balance += (noise * drift + ropeLat / cfg.feature.ropeTip) * DT + mem.steerTap * cfg.feature.tapStrength
		if math.abs(j.balance) > 1 then
			endSlide(s)
			Actions.crash(s, "fellOffFeature")
			return
		end
	end
	j.time += DT
	local nearest = Scalar.round(j.boardAngle / (math.pi / 2)) * (math.pi / 2)
	if math.abs(j.boardAngle - nearest) < deg(20) then
		local id = OnFeature.slideIdAt(j.boardAngle, f.heading, f.heading, r)
		j.slideTimes[id] += DT
		if #j.slideOrder == 0 or j.slideOrder[#j.slideOrder] ~= id then
			table.insert(j.slideOrder, id)
		end
	end

	if input.pop then
		r.popCharge = Pop.ollieCharge(mem.popHeldTime, cfg)
	end
	if mem.popReleased then
		local charge = Pop.ollieCharge(mem.popHeldTime, cfg)
		leaveFeature(s, f, Pop.ollieSpeed(charge, cfg), charge)
		return
	end

	ramp.u += vt * Vec.dot(t, Vec.forwardOf(f.heading)) * DT
	ramp.v += vl * DT
	local nextSurface = Features.surfaceAt(f, { u = ramp.u, v = ramp.v })
	if not nextSurface or not nextSurface.onTop then
		if math.abs(ramp.v) > def.width / 2 + 0.3 then
			endSlide(s)
			Actions.crash(s, "fellOffFeature")
			return
		end
		r.vel = Vec.add(Vec.scale(t, vt), Vec.scale(right, vl))
		r.pos = Features.toWorld(f, ramp.u, ramp.v, surface.height)
		leaveFeature(s, f, 0, 0)
		return
	end
	r.pos = Features.toWorld(f, ramp.u, ramp.v, nextSurface.height)
	r.vel = Vec.add(Vec.scale(nextSurface.tangent, vt), Vec.scale(right, vl))
	r.heading = f.heading
end

-- In the air over a feature: clearance check, crashes, landing on a main.
function OnFeature.airOverFeature(s, air)
	local r = s.rider
	local hit = Features.featureUnder(s.features, r.pos)
	if not hit then
		air.overFeature = nil
		return false
	end
	local feature, l, surface = hit.feature, hit["local"], hit.surface
	local part = feature.def.id .. ":" .. (if surface.onTop then "main" else "ramp")
	local isMain = feature.def.kind == "slider" and surface.onTop
	local clearance = if isMain then s.cfg.ollie.clearance else 0
	if air.overFeature ~= part then
		if r.pos.y < surface.height + clearance then
			Actions.crash(s, if isMain then "shortOllie" else "hitFeature")
			return true
		end
		air.overFeature = part
	end
	if r.pos.y > surface.height or r.vel.y >= 0 then
		return false
	end
	if not isMain then
		Actions.crash(s, "hitFeature")
		return true
	end
	local yaw = Scalar.wrapAngle(r.heading + air.rot.spinAngle - feature.heading)
	local quarter = Scalar.round(yaw / (math.pi / 2))
	local boardAngle = quarter * (math.pi / 2)
	local offQuarter = math.abs(yaw - boardAngle)
	local level = table.clone(air)
	level.rot = table.clone(air.rot)
	level.rot.spinAngle = Scalar.round(air.rot.spinAngle / math.pi) * math.pi
	local landing = Landing.evaluateLanding(r, level, surface.normal, s.cfg)
	if offQuarter > s.cfg.landing.maxYawError or landing.crash then
		Actions.crash(s, landing.crash or "badLandingYaw", landing)
		return true
	end
	if r.handle == "passing" then
		r.handle = "inFront"
	end
	local speed = math.max(Vec.dot(r.vel, surface.tangent), s.cfg.feature.stallSpeed + 0.5)
	r.air = nil
	mountMain(s, feature, l.u, l.v, speed, "ollieOn", false, boardAngle)
	table.insert(s.events, { type = "landed", tick = s.tick, air = air, landing = landing, onFeature = true })
	table.insert(s.events, { type = "featureEnter", tick = s.tick, featureId = feature.def.id })
	return true
end

return OnFeature
