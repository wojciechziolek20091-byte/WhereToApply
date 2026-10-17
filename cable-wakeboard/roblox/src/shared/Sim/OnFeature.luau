-- Kickers and obstacles on any feature's ride pieces (FeatureShapes): ramps to
-- a lip, the safety and its pop window, sliding mains (kinks, exit ramps;
-- 90-degree steps, balance, handle passes), landing on a main or a landing
-- ramp, riding back out into the water. Mirrors src/sim/onFeature.ts.
local Actions = require(script.Parent.Actions)
local BodyPhysics = require(script.Parent.BodyPhysics)
local Config = require(script.Parent.Config)
local DetMath = require(script.Parent.DetMath)
local Edge = require(script.Parent.Edge)
local Features = require(script.Parent.Features)
local EntryResolver = require(script.Parent.FeatureRideEntryResolver)
local SlideController = require(script.Parent.FeatureRideSlideController)
local FeatureShapes = require(script.Parent.FeatureShapes)
local Fsm = require(script.Parent.Fsm)
local Handle = require(script.Parent.Handle)
local Landing = require(script.Parent.Landing)
local Pop = require(script.Parent.Pop)
local Posture = require(script.Parent.Posture)
local Rotation = require(script.Parent.Rotation)
local Scalar = require(script.Parent.Scalar)
local Vec = require(script.Parent.Vec)

local DT, GRAVITY = Config.DT, Config.GRAVITY
local OnFeature = {}
local stepWall, startJib

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

-- The safety's pop window: from `start` (m along the feature) to the end of the safety piece.
function OnFeature.safetyWindow(p, cfg)
	local len = math.max((p.u1 - p.u0) * cfg.safety.popWindowFraction, cfg.safety.popWindowMinMetres)
	return { start = math.max(p.u0, p.u1 - len), ["end"] = p.u1 }
end

-- The first slideable piece starting where p ends (a flush main), if any.
local function flushNext(f, p)
	for _, q in f.shape.pieces do
		if q.slide and q.axis == "u" and q.u0 == p.u1 then
			return q
		end
	end
	return nil
end

-- First piece of a part.
local function partStart(f, part)
	for _, q in f.shape.pieces do
		if q.part == part then
			return q
		end
	end
	error("no piece in part " .. tostring(part))
end

local function rampMode(p)
	return if p.role == "Safety" then "onSafety" else "onKicker"
end

local function descending(p)
	return p.h1 < p.h0
end

function OnFeature.tryEnterFeature(s)
	local r = s.rider
	local hit = Features.featureUnder(s.features, r.pos)
	if not hit then
		return false
	end
	local feature, l, surface = hit.feature, hit["local"], hit.surface
	if surface.height < 0 then
		return false
	end
	local speed = Vec.horizontalLength(r.vel)
	local along = if speed > 0.1 then Vec.dot(Vec.horizontal(r.vel), Vec.forwardOf(feature.heading)) / speed else 0
	if r.mode == "ridingBlind" or surface.height > s.cfg.feature.mountHeight or along < DetMath.cos(s.cfg.feature.mountAngle) then
		Actions.crash(s, "hitFeature")
		return true
	end
	r.ramp = { featureId = feature.def.id, u = l.u, v = l.v, releaseTick = -1, releaseTimeToLip = -1, sketchy = false }
	if surface.piece.wall then
		-- Up a wall ride's transition: a slide on the wall.
		r.jib = startJib(s, feature, 0, "rideOn", false)
		Fsm.transition(s, "onFeature", "wallRide")
		table.insert(s.events, { type = "featureEnter", tick = s.tick, featureId = feature.def.id })
		return true
	end
	Fsm.transition(s, rampMode(surface.piece), "rideOn")
	table.insert(s.events, { type = "featureEnter", tick = s.tick, featureId = feature.def.id })
	return true
end

startJib = function(s, feature, boardAngle, entry, sketchy)
	local rot = Rotation.createRotation(s.cfg.handlePass.featureWindow)
	return {
		featureId = feature.def.id,
		balance = 0,
		boardAngle = boardAngle,
		targetAngle = boardAngle,
		entryAngle = boardAngle,
		time = 0,
		slideTimes = { fiftyFifty = 0, switchFiftyFifty = 0, backboard = 0, frontboard = 0, wallRide = 0 },
		slideOrder = {},
		entry = entry,
		inRotation = 0,
		entryQuality = 1,
		fore = 0,
		pitch = 0,
		lift = 0,
		spiked = false,
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

local function leaveFeature(s, f, popSpeed, popQuality, from)
	local r = s.rider
	local spinStart = if r.jib then Scalar.wrapAngle(r.jib.boardAngle) else 0
	local keepHandle = r.handle
	endSlide(s)
	table.insert(s.events, { type = "featureExit", tick = s.tick, featureId = f.def.id })
	local piece = from
	if not piece and r.ramp then
		local surf = Features.surfaceAt(f, { u = r.ramp.u, v = r.ramp.v })
		piece = if surf then surf.piece else nil
	end
	-- Off a ramp's lip is a kicker takeoff; with no piece under the rider, the feature's entry decides.
	local src = piece or f.shape.pieces[1]
	local fromRamp = src.lip and not src.slide
	local air = Actions.takeOff(s, if fromRamp then "kicker" else "feature", f.def.id, popSpeed, popQuality, spinStart)
	-- Off a lip straight onto the next part (a pyramid's top), that part counts as left too.
	local onto = nil
	if piece and piece.lip then
		for _, q in f.shape.pieces do
			if q.axis == "u" and q.u0 == piece.u1 and q.part ~= piece.part then
				onto = q
				break
			end
		end
	end
	air.overFeature = f.def.id .. ":" .. tostring(if onto then onto.part elseif piece then piece.part else 0)
	-- The part left from: landing on another one is a transfer.
	table.insert(air.cleared, air.overFeature)
	r.handle = if keepHandle == "passing" then "inFront" else keepHandle
	return air
end

-- Ride off a feature's end into the water.
local function rideOut(s, f)
	local r = s.rider
	endSlide(s)
	table.insert(s.events, { type = "featureExit", tick = s.tick, featureId = f.def.id })
	r.pos = Vec.vec3(r.pos.x, 0, r.pos.z)
	r.vel = Vec.horizontal(r.vel)
	if Vec.horizontalLength(r.vel) > 0.5 then
		r.heading = Vec.headingOf(r.vel)
	end
	r.ramp = nil
	r.jib = nil
	r.popCharge = 0
	Fsm.transition(s, "riding", "rodeOut")
end

-- Get onto a main (a slideable piece): from the safety, or landing from the air.
local function mountMain(s, f, main, u, v, speed, entry, sketchy, boardAngle)
	boardAngle = boardAngle or 0
	local r = s.rider
	local start = partStart(f, main.part)
	local mu = math.max(u, start.u0)
	local top = Features.surfaceAt(f, { u = mu, v = v })
	local height = if top then top.height else main.h0
	r.ramp = { featureId = f.def.id, u = mu, v = v, releaseTick = -1, releaseTimeToLip = -1, sketchy = sketchy }
	r.pos = Features.toWorld(f, r.ramp.u, v, height)
	local along = if f.shape.legacy or not top then Vec.forwardOf(f.heading) else top.tangent
	r.vel = Vec.scale(along, math.max(speed, s.cfg.feature.stallSpeed + 0.5))
	r.heading = if f.shape.legacy then f.heading else Features.pieceHeading(f, if top then top.piece else main)
	r.jib = startJib(s, f, boardAngle, entry, sketchy)
	r.jib.pitch = DetMath.atan(if top then top.slope else 0)
	r.popCharge = 0
	Fsm.transition(s, "onFeature", entry)
end

-- One tick on a ramp-like piece: kicker ramp, safety, landing ramp, pyramid face.
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
		leaveFeature(s, f, 0, 0, nil)
		return
	end
	local piece = surface.piece
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
		if piece.role ~= "Safety" then
			ramp.releaseTimeToLip = (piece.u1 - ramp.u) / horizontalSpeed
		else
			-- Into the air off the safety (spec 3.6): in the window with a flush
			-- main, no clearance check onto it; an early pop has to clear it.
			local w = OnFeature.safetyWindow(piece, cfg)
			local inWindow = ramp.u >= w.start
			local centre = (w.start + w["end"]) / 2
			local perfect = inWindow and math.abs(ramp.u - centre) <= (cfg.safety.perfectFraction * (w["end"] - w.start)) / 2
			local main = flushNext(f, piece)
			r.vel = Vec.add(Vec.scale(t, vt), Vec.scale(right, vl))
			local charge = Pop.ollieCharge(mem.popHeldTime, cfg)
			local air = leaveFeature(s, f, Pop.ollieSpeed(charge, cfg) * cfg.safety.gapPopScale, charge, piece)
			air.pendingEntry = if perfect then "popOn" else "pop"
			if main and inWindow then
				table.insert(air.cleared, f.def.id .. ":" .. tostring(main.part))
			end
			if ramp.sketchy then
				air.tailClip = true
			end
			return
		end
	end

	ramp.u += vt * Vec.dot(t, Vec.forwardOf(f.heading)) * DT
	ramp.v += vl * DT
	local nextSurface = Features.surfaceAt(f, { u = ramp.u, v = ramp.v })
	if nextSurface and nextSurface.onTop and not piece.slide and not piece.lip then
		if f.shape.safetyMode == "Gap" then
			Actions.crash(s, "missedSafetyPop")
			return
		end
		mountMain(s, f, nextSurface.piece, ramp.u, ramp.v, vt, "rideOn", ramp.sketchy)
		return
	end
	if piece.role == "Safety" and f.shape.safetyMode == "Gap" and not nextSurface and ramp.u >= piece.u1 and not flushNext(f, piece) then
		Actions.crash(s, "missedSafetyPop")
		return
	end
	if descending(piece) and (not nextSurface or nextSurface.height < 0) then
		r.vel = Vec.add(Vec.scale(t, vt), Vec.scale(right, vl))
		rideOut(s, f)
		return
	end
	if not nextSurface or (piece.lip and nextSurface.piece.part ~= piece.part) then
		r.vel = Vec.add(Vec.scale(t, vt), Vec.scale(right, vl))
		r.pos = Features.toWorld(f, ramp.u, ramp.v, surface.height)
		local popSpeed = 0
		local quality = 0
		local lipPop = piece.lip and ramp.releaseTimeToLip >= 0 and ramp.releaseTimeToLip <= cfg.kicker.lipPopWindow
		if lipPop and r.vel.y > 0 then
			popSpeed = r.vel.y * cfg.kicker.lipPopBonus
			quality = 1 - ramp.releaseTimeToLip / cfg.kicker.lipPopWindow
		end
		local air = leaveFeature(s, f, popSpeed, quality, piece)
		air.lipPop = lipPop
		return
	end
	r.pos = Features.toWorld(f, ramp.u, ramp.v, nextSurface.height)
	r.vel = Vec.add(Vec.scale(nextSurface.tangent, vt), Vec.scale(right, vl))
	r.heading = f.heading
end

-- One tick on a wall ride: climb the transition (and the wall) with the speed
-- the rider cut in with; gravity pulls back down the profile, the rope pulls
-- along it. Ride back out, run off the end into the air, pop off, or go over
-- the top (crash).
stepWall = function(s, input, mem, f)
	local r, cfg = s.rider, s.cfg
	local ramp = r.ramp
	local j = r.jib
	local m = cfg.rider.mass
	Posture.updatePosture(r, if input.armsOut then 0 else 1, input.pop, r.ropeTension, cfg.posture, DT)
	local rope = Actions.applyRope(s)
	if not rope then
		return
	end
	local piece = f.shape.pieces[1]
	local w = piece.wall
	local top = f.shape.pieces[#f.shape.pieces].wall.d1
	local fwd = Vec.forwardOf(f.heading)
	local right = Vec.rightOf(f.heading)
	local x = (ramp.v - w.base) * w.side
	local prof = FeatureShapes.wallHeightAt(w, x)
	local cosT = 1 / math.sqrt(1 + prof.slope * prof.slope)
	local sinT = prof.slope * cosT
	local vu = Vec.dot(r.vel, fwd)
	local ws = Vec.dot(r.vel, right) * w.side * cosT + r.vel.y * sinT
	local speed = math.sqrt(vu * vu + ws * ws)
	local friction = if f.shape.friction then f.shape.friction else cfg.feature.friction
	local fr = if speed > 1e-6 then (friction * GRAVITY * cosT) / speed else 0
	vu += (Vec.dot(rope.force, fwd) / m - fr * vu) * DT
	ws += (-GRAVITY * sinT + (Vec.dot(rope.force, right) * w.side * cosT) / m - fr * ws) * DT
	r.edgeLoad = 0
	if vu < cfg.feature.stallSpeed then
		endSlide(s)
		Actions.crash(s, "fellOffFeature")
		return
	end
	j.time += DT
	j.slideTimes.wallRide += DT
	if #j.slideOrder == 0 then
		table.insert(j.slideOrder, "wallRide")
	end
	local function along(u, wsNow, c, sn)
		return Vec.add(Vec.add(Vec.scale(fwd, u), Vec.scale(right, w.side * wsNow * c)), Vec.vec3(0, wsNow * sn, 0))
	end

	if input.pop then
		r.popCharge = Pop.ollieCharge(mem.popHeldTime, cfg)
	end
	if mem.popReleased then
		local charge = Pop.ollieCharge(mem.popHeldTime, cfg)
		local out = Pop.ollieSpeed(charge, cfg) * cfg.feature.wallPopOut
		r.vel = Vec.add(along(vu, ws, cosT, sinT), Vec.add(Vec.scale(right, -w.side * out * sinT), Vec.vec3(0, out * cosT, 0)))
		leaveFeature(s, f, 0, charge, piece)
		return
	end

	x += ws * cosT * DT
	ramp.u += vu * DT
	ramp.v = w.base + w.side * x
	if x >= top then
		endSlide(s)
		Actions.crash(s, "fellOffFeature")
		return
	end
	local nextProf = FeatureShapes.wallHeightAt(w, math.max(x, 0))
	local c2 = 1 / math.sqrt(1 + nextProf.slope * nextProf.slope)
	local s2 = nextProf.slope * c2
	if nextProf.height <= 0 and ws < 0 then
		r.vel = Vec.add(Vec.scale(fwd, vu), Vec.scale(right, w.side * ws * c2))
		rideOut(s, f)
		return
	end
	r.pos = Features.toWorld(f, ramp.u, ramp.v, nextProf.height)
	r.vel = along(vu, ws, c2, s2)
	r.heading = f.heading
	if ramp.u > piece.u1 or ramp.u < piece.u0 then
		leaveFeature(s, f, 0, 0, piece)
	end
end

-- One tick sliding a main of a box or rail: flat, kinked, or down an exit ramp.
function OnFeature.stepSlide(s, input, mem)
	local r, cfg = s.rider, s.cfg
	local ramp = r.ramp
	local j = r.jib
	if not ramp or not j then
		error("onFeature without RampState / JibState")
	end
	local f = featureById(s, ramp.featureId)
	if f.shape.pieces[1].wall then
		stepWall(s, input, mem, f)
		return
	end
	local m = cfg.rider.mass
	Posture.updatePosture(r, if input.armsOut then 0 else 1, input.pop, r.ropeTension, cfg.posture, DT)
	local rope = Actions.applyRope(s)
	if not rope then
		return
	end
	local surface = Features.surfaceAt(f, { u = ramp.u, v = ramp.v })
	if not surface or not surface.onTop then
		leaveFeature(s, f, 0, 0, nil)
		return
	end
	local piece = surface.piece
	local heading = if f.shape.legacy then f.heading else Features.pieceHeading(f, piece)
	local t = surface.tangent
	local right = Vec.rightOf(heading)
	local friction = SlideController.slideFriction(f, j, s)
	local vt = Vec.dot(r.vel, t)
	local vl = Vec.dot(r.vel, right)
	local at = (Vec.dot(rope.force, t) - m * GRAVITY * t.y - friction * m * GRAVITY * surface.normal.y * Scalar.sign(vt)) / m
	vt += at * DT
	local ropeLat = Vec.dot(rope.force, right)
	vl += (ropeLat / m - cfg.feature.lateralDamping * vl) * DT
	r.edgeLoad = 0
	if vt < cfg.featureRide.Slide.StallSpeed then
		endSlide(s)
		Actions.crash(s, "stalled")
		return
	end
	local kink = SlideController.stepKink(s, j, DetMath.atan(surface.slope), vt, input)
	if kink then
		endSlide(s)
		Actions.crash(s, kink)
		return
	end

	local stepRate = math.pi / 2 / cfg.feature.rotateTimePer90
	if j.boardAngle == j.targetAngle and mem.steerDir ~= 0 and mem.steerHeldTime >= cfg.feature.tapTime then
		local dir = mem.steerDir
		if j.rot.spinSide == nil then
			j.rot.spinSide = Rotation.rotationSide(dir, heading + j.boardAngle, Edge.toeSign(r), r.ropeHeading)
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

	local fell = SlideController.stepBalance(s, j, f, piece, surface, ramp.u, ropeLat, Vec.dot(rope.force, t), mem)
	if fell == "fell" then
		endSlide(s)
		Actions.crash(s, "fellOffFeature")
		return
	end
	if fell == "sketchyExit" then
		j.sketchy = true
		r.vel = Vec.add(Vec.scale(t, vt), Vec.scale(right, vl))
		leaveFeature(s, f, 0, 0, piece)
		return
	end
	j.time += DT
	local nearest = Scalar.round(j.boardAngle / (math.pi / 2)) * (math.pi / 2)
	if math.abs(j.boardAngle - nearest) < deg(20) then
		local id = OnFeature.slideIdAt(j.boardAngle, heading, heading, r)
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
		-- A/D pressed as the pop goes: hop sideways (transfers).
		if not f.shape.legacy and mem.steerDir ~= 0 then
			r.vel = Vec.add(r.vel, Vec.scale(right, mem.steerDir * cfg.feature.sideHop))
		end
		leaveFeature(s, f, Pop.ollieSpeed(charge, cfg), charge, piece)
		return
	end

	local fwd = Vec.forwardOf(f.heading)
	if piece.v1 == piece.v0 then
		ramp.u += vt * Vec.dot(t, fwd) * DT
		ramp.v += vl * DT
	else
		local vel = Vec.add(Vec.scale(t, vt), Vec.scale(right, vl))
		ramp.u += Vec.dot(vel, fwd) * DT
		ramp.v += Vec.dot(vel, Vec.rightOf(f.heading)) * DT
	end
	local nextSurface = Features.surfaceAt(f, { u = ramp.u, v = ramp.v })
	if nextSurface and nextSurface.height < 0 then
		r.vel = Vec.add(Vec.scale(t, vt), Vec.scale(right, vl))
		rideOut(s, f)
		return
	end
	if not nextSurface or not nextSurface.onTop then
		if math.abs(Features.offCentre(piece, ramp)) > piece.width / 2 + 0.3 then
			endSlide(s)
			Actions.crash(s, "fellOffFeature")
			return
		end
		r.vel = Vec.add(Vec.scale(t, vt), Vec.scale(right, vl))
		if nextSurface and nextSurface.piece.role == "LandingRamp" and nextSurface.piece.u0 == piece.u1 then
			endSlide(s)
			r.jib = nil
			r.pos = Features.toWorld(f, ramp.u, ramp.v, nextSurface.height)
			r.heading = f.heading
			Fsm.transition(s, "onKicker", "rollDown")
			return
		end
		if descending(piece) and piece.h1 <= 0.05 then
			rideOut(s, f)
			return
		end
		r.pos = Features.toWorld(f, ramp.u, ramp.v, surface.height)
		leaveFeature(s, f, 0, 0, piece)
		return
	end
	r.pos = Features.toWorld(f, ramp.u, ramp.v, nextSurface.height)
	r.vel = Vec.add(Vec.scale(nextSurface.tangent, vt), Vec.scale(right, vl))
	r.heading = if f.shape.legacy then f.heading else Features.pieceHeading(f, nextSurface.piece)
end

-- Land on a landing ramp: an ordinary landing, then ride down it.
local function landOnRamp(s, f, air, surface, u, v)
	local r = s.rider
	local landing = Landing.evaluateLanding(r, air, surface.normal, s.cfg)
	r.pos = Features.toWorld(f, u, v, surface.height)
	if landing.crash then
		Actions.crash(s, landing.crash, landing)
		return
	end
	if math.abs(Scalar.round(air.rot.spinAngle / math.pi)) % 2 == 1 then
		r.switchStance = not r.switchStance
	end
	if r.handle == "passing" then
		r.handle = "inFront"
	end
	local keep = BodyPhysics.landingSpeedKeep(s.cfg, landing.impact, landing.clean)
	r.vel = Vec.scale(surface.tangent, math.max(Vec.dot(r.vel, surface.tangent) * keep, s.cfg.feature.stallSpeed + 0.5))
	r.heading = f.heading
	r.air = nil
	r.ramp = { featureId = f.def.id, u = u, v = v, releaseTick = -1, releaseTimeToLip = -1, sketchy = false }
	Fsm.transition(s, "onKicker", "landedOnRamp")
	table.insert(s.events, { type = "landed", tick = s.tick, air = air, landing = landing, onFeature = false })
end

-- Ollie onto a safety (spec 3.5): landing rules, slope match, flat base; then up it.
local function landOnSafety(s, f, air, surface, u, v)
	local r = s.rider
	local R = s.cfg.featureRide
	local landing = Landing.evaluateLanding(r, air, surface.normal, s.cfg)
	r.pos = Features.toWorld(f, u, v, surface.height)
	local pitch = EntryResolver.safetyPitchError(air, surface.slope)
	local reason = landing.crash
	if not reason then
		if pitch > R.Safety.LandingPitchCrash then
			reason = "badAngle"
		elseif air.entry and air.entry.roll > R.Landing.MaxRoll then
			reason = "slippedOut"
		end
	end
	if reason then
		Actions.crash(s, reason, landing)
		return
	end
	if math.abs(Scalar.round(air.rot.spinAngle / math.pi)) % 2 == 1 then
		r.switchStance = not r.switchStance
	end
	if r.handle == "passing" then
		r.handle = "inFront"
	end
	local keep = BodyPhysics.landingSpeedKeep(s.cfg, landing.impact, landing.clean)
	r.vel = Vec.scale(surface.tangent, math.max(Vec.dot(r.vel, surface.tangent) * keep, s.cfg.feature.stallSpeed + 0.5))
	r.heading = f.heading
	r.air = nil
	local sketchy = pitch > R.Safety.LandingPitchTolerance or air.tailClip
	r.ramp = { featureId = f.def.id, u = u, v = v, releaseTick = -1, releaseTimeToLip = -1, sketchy = sketchy }
	Fsm.transition(s, "onSafety", "landedOnSafety")
	table.insert(s.events, { type = "landed", tick = s.tick, air = air, landing = landing, onFeature = false })
	table.insert(s.events, { type = "featureEnter", tick = s.tick, featureId = f.def.id })
end

-- In the air over a feature: clearance check, crashes, landing on a main or a landing ramp.
function OnFeature.airOverFeature(s, air)
	local r = s.rider
	local hit = Features.featureUnder(s.features, r.pos)
	local was = air.overFeature
	if
		was ~= nil
		and (not hit or hit.feature.def.id .. ":" .. tostring(hit.surface.piece.part) ~= was)
		and EntryResolver.overshotSide(s, air, was)
	then
		Actions.crash(s, "overshoot")
		return true
	end
	if not hit then
		air.overFeature = nil
		return false
	end
	local feature, l, surface = hit.feature, hit["local"], hit.surface
	local piece = surface.piece
	local part = feature.def.id .. ":" .. tostring(piece.part)
	local isMain = surface.onTop and not piece.wall
	if air.overFeature ~= part then
		if not table.find(air.cleared, part) then
			local reason = nil
			if isMain or piece.role == "Safety" then
				reason = EntryResolver.crossEdge(s, air, feature, l, surface, part)
			elseif r.pos.y < surface.height then
				reason = "hitFeature"
			end
			if reason then
				Actions.crash(s, reason)
				return true
			end
		end
		air.overFeature = part
	end
	if r.pos.y > surface.height or r.vel.y >= 0 then
		return false
	end
	if piece.role == "LandingRamp" then
		landOnRamp(s, feature, air, surface, l.u, l.v)
		return true
	end
	if piece.role == "Safety" then
		landOnSafety(s, feature, air, surface, l.u, l.v)
		return true
	end
	if not isMain then
		Actions.crash(s, "hitFeature")
		return true
	end
	local heading = if feature.shape.legacy then feature.heading else Features.pieceHeading(feature, piece)
	local e = EntryResolver.resolveLanding(s, air, feature, surface, l, heading)
	local landing = e.landing
	if not e.success then
		Actions.crash(s, e.failReason or "badAngle", landing)
		return true
	end
	if r.handle == "passing" then
		r.handle = "inFront"
	end
	local keep = BodyPhysics.landingSpeedKeep(s.cfg, landing.impact, landing.clean) * e.speedKeep
	local speed = math.max(Vec.dot(r.vel, surface.tangent) * keep, s.cfg.feature.stallSpeed + 0.5)
	r.air = nil
	mountMain(s, feature, piece, l.u, l.v, speed, e.kind, e.sketchy, e.boardAngle)
	local j = r.jib
	j.balance = e.balance
	j.inRotation = e.inRotation
	j.entryQuality = e.quality
	table.insert(s.events, { type = "landed", tick = s.tick, air = air, landing = landing, onFeature = true })
	table.insert(s.events, { type = "featureEnter", tick = s.tick, featureId = feature.def.id })
	return true
end

return OnFeature
