-- Rider state transitions shared by the per-mode steps. Mirrors src/sim/actions.ts.
local Air = require(script.Parent.Air)
local Config = require(script.Parent.Config)
local Landing = require(script.Parent.Landing)
local Rope = require(script.Parent.Rope)
local Vec = require(script.Parent.Vec)

local DT = Config.DT
local Actions = {}

-- Hips position: the rope attaches here. Bent knees lower the hips.
function Actions.hipPosition(s)
	return Vec.addScaled(s.rider.pos, Vec.UP, s.cfg.rider.hipHeight * (1 - 0.35 * s.rider.legCompression))
end

function Actions.setMode(s, mode)
	if s.rider.mode ~= mode then
		s.rider.mode = mode
		s.rider.modeTime = 0
	end
end

-- Rope tension this tick, with slack, snap and grip tracking.
function Actions.applyRope(s)
	local rider, cfg = s.rider, s.cfg
	if not rider.hasHandle then
		rider.ropeTension = 0
		rider.ropeForce = Vec.vec3()
		return { tension = 0, dir = Vec.UP, force = Vec.vec3(), stretch = -1, stretchRate = 0 }
	end
	local rope = Rope.computeRopeTension(
		s.carrier.pos,
		s.carrier.vel,
		Actions.hipPosition(s),
		rider.vel,
		cfg.rope.length + rider.handleDist,
		cfg.rope
	)
	local wasSlack = rider.ropeTension <= 0
	if rope.tension <= 0 then
		rider.slackTime += DT
	else
		if wasSlack and rider.slackTime > 0.2 and rope.stretchRate > cfg.rope.snapRate then
			table.insert(s.events, { type = "ropeSnap", tick = s.tick, stretchRate = rope.stretchRate })
		end
		rider.slackTime = 0
	end
	rider.ropeTension = rope.tension
	rider.ropeForce = rope.force
	rider.ropeHeading = Vec.headingOf(rope.dir)
	rider.overGripTime = if rope.tension > cfg.rope.gripLimit then rider.overGripTime + DT else 0
	return rope
end

-- Let go, or have the handle ripped away. Returns true the tick it happens.
function Actions.checkGrip(s, input)
	local rider, cfg = s.rider, s.cfg
	if not rider.hasHandle then
		return false
	end
	if input.release or rider.overGripTime > cfg.rope.gripTime then
		rider.hasHandle = false
		rider.connection = 0
		rider.ropeTension = 0
		rider.ropeForce = Vec.vec3()
		return true
	end
	return false
end

function Actions.fallRider(s, kind, landing)
	local r = s.rider
	table.insert(s.events, { type = "fall", tick = s.tick, kind = kind, air = r.air, landing = landing })
	Actions.setMode(s, "fallen")
	r.lastFall = kind
	r.fallTimer = s.cfg.landing.fallRecovery
	r.hasHandle = false
	r.connection = 0
	r.edgeAngle = 0
	r.air = nil
	r.ramp = nil
	r.jib = nil
	r.pos = Vec.vec3(r.pos.x, 0, r.pos.z)
	r.vel = Vec.vec3(r.vel.x, 0, r.vel.z)
end

-- Leave the surface with an upward speed and start an AirState.
function Actions.takeOff(s, source, featureId, popSpeed, popQuality, edgeLoadAtBase, input)
	local r = s.rider
	r.vel = Vec.add(r.vel, Vec.vec3(0, popSpeed, 0))
	r.pos = Vec.addScaled(r.pos, Vec.UP, 1e-3)
	r.air = Air.createAirState(r, source, featureId, popSpeed, popQuality, edgeLoadAtBase, input, s.cfg)
	r.ramp = nil
	r.jib = nil
	r.extendTimer = s.cfg.pop.extendTime
	Actions.setMode(s, "air")
	table.insert(s.events, { type = "takeoff", tick = s.tick, source = source, popSpeed = popSpeed, popQuality = popQuality })
end

-- Load released this tick with bent knees: the legs extend.
function Actions.popReleased(s, input)
	return s.rider.loadHeld and not input.load and s.rider.legCompression > 0.15
end

-- Touch down on a surface. Returns the landing result.
function Actions.touchDown(s, air, normal, surfaceY)
	local r = s.rider
	local landing = Landing.evaluateLanding(r, air, normal, s.cfg)
	r.pos = Vec.vec3(r.pos.x, surfaceY, r.pos.z)
	if landing.fall then
		Actions.fallRider(s, landing.fall, landing)
		return landing
	end
	if math.fmod(math.abs(landing.halfTurns), 2) == 1 then
		r.switchStance = not r.switchStance
	end
	r.vel = Vec.vec3(r.vel.x, 0, r.vel.z)
	r.heading = if Vec.horizontalLength(r.vel) > 0.5 then Vec.headingOf(r.vel) else air.takeoffHeading
	r.air = nil
	r.load = { edgeLoadAtBase = 0, peakEdgeLoad = 0, peakAge = 0 }
	Actions.setMode(s, "riding")
	table.insert(s.events, { type = "landed", tick = s.tick, air = air, landing = landing })
	return landing
end

return Actions
