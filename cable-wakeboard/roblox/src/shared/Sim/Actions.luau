-- Rider state transitions shared by the per-mode steps: rope, crash, takeoff,
-- touchdown. Mirrors src/sim/actions.ts.
local Air = require(script.Parent.Air)
local Config = require(script.Parent.Config)
local Fsm = require(script.Parent.Fsm)
local Landing = require(script.Parent.Landing)
local Pop = require(script.Parent.Pop)
local Rope = require(script.Parent.Rope)
local Scalar = require(script.Parent.Scalar)
local Vec = require(script.Parent.Vec)

local DT = Config.DT
local Actions = {}

-- Hips position: the rope attaches here. Bent knees lower the hips.
function Actions.hipPosition(s)
	return Vec.addScaled(s.rider.pos, Vec.UP, s.cfg.rider.hipHeight * (1 - 0.35 * s.rider.legCompression))
end

local function offBalance(s)
	return s.rider.connection < 0.6 or s.rider.mode == "landing" or s.rider.mode == "ridingBlind"
end

-- Rope tension this tick: capped, smoothed, and a hard snap back to taut while
-- off balance crashes (rope yank). Returns nil when the yank crashed the rider.
function Actions.applyRope(s)
	local rider, cfg = s.rider, s.cfg
	if rider.handle == "dropped" then
		rider.ropeTension = 0
		rider.ropeForce = Vec.vec3()
		Pop.updateTensionTracker(rider, cfg, DT)
		return { tension = 0, dir = Vec.UP, force = Vec.vec3(), stretch = -1, stretchRate = 0 }
	end
	local raw = Rope.computeRopeTension(
		s.carrier.pos,
		s.carrier.vel,
		Actions.hipPosition(s),
		rider.vel,
		cfg.rope.length + rider.handleDist,
		cfg.rope
	)
	local cap = if rider.mode == "ridingBlind" then math.min(cfg.rope.maxTension, cfg.blind.maxTension) else cfg.rope.maxTension
	local tension = math.min(raw.tension, cap)
	local rope = table.clone(raw)
	rope.tension = tension
	rope.force = Vec.scale(raw.dir, tension)
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
	Pop.updateTensionTracker(rider, cfg, DT)
	local onSurface = rider.mode ~= "airborne" and rider.mode ~= "waterTrickAir"
	if wasSlack and onSurface and raw.tension > cfg.rope.yankCrashImpulse and offBalance(s) then
		Actions.crash(s, "ropeYank")
		return nil
	end
	return rope
end

-- Every crash goes through here.
function Actions.crash(s, reason, landing)
	local r = s.rider
	table.insert(s.events, { type = "crash", tick = s.tick, reason = reason, air = r.air, landing = landing })
	Fsm.transition(s, "crashed", reason)
	r.lastCrash = reason
	r.crashTimer = s.cfg.crash.respawnDelay
	r.handle = "dropped"
	r.connection = 0
	r.edgeAngle = 0
	r.air = nil
	r.ramp = nil
	r.jib = nil
	r.spinOut = nil
	r.ropeTension = 0
	r.ropeForce = Vec.vec3()
	r.pos = Vec.vec3(r.pos.x, 0, r.pos.z)
	r.vel = Vec.vec3(r.vel.x, 0, r.vel.z)
end

-- Leave the surface with an upward speed and start an AirState.
function Actions.takeOff(s, source, featureId, popSpeed, popQuality, spinStart)
	local r = s.rider
	r.vel = Vec.add(r.vel, Vec.vec3(0, popSpeed, 0))
	r.pos = Vec.addScaled(r.pos, Vec.UP, 1e-3)
	local air = Air.createAirState(r, source, featureId, popSpeed, popQuality, s.cfg, spinStart or 0)
	r.air = air
	r.ramp = nil
	r.jib = nil
	r.popCharge = 0
	Fsm.transition(s, if source == "waterTrick" then "waterTrickAir" else "airborne", source)
	table.insert(s.events, { type = "takeoff", tick = s.tick, source = source, popSpeed = popSpeed, popQuality = popQuality })
	return air
end

-- Touch down on the water: crash, or the landing grace state.
function Actions.touchDown(s, air, normal, surfaceY)
	local r = s.rider
	local landing = Landing.evaluateLanding(r, air, normal, s.cfg)
	r.pos = Vec.vec3(r.pos.x, surfaceY, r.pos.z)
	if landing.crash then
		Actions.crash(s, landing.crash, landing)
		return landing
	end
	if math.fmod(math.abs(Scalar.round(air.rot.spinAngle / math.pi)), 2) == 1 then
		r.switchStance = not r.switchStance
	end
	if r.handle == "passing" then
		r.handle = "inFront"
	end
	if r.handle == "behind" then
		r.blindDir = if air.rot.blindDir ~= 0 then air.rot.blindDir else r.blindDir
		r.blindTime = 0
	end
	r.vel = Vec.vec3(r.vel.x, 0, r.vel.z)
	r.heading = if Vec.horizontalLength(r.vel) > 0.5 then Vec.headingOf(r.vel) else air.takeoffHeading
	r.air = nil
	Fsm.transition(s, "landing", "touchdown")
	table.insert(s.events, { type = "landed", tick = s.tick, air = air, landing = landing, onFeature = false })
	return landing
end

return Actions
