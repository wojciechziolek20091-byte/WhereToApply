-- Sim state creation and respawn. Mirrors src/sim/world.ts.
local Cable = require(script.Parent.Cable)
local Config = require(script.Parent.Config)
local Input = require(script.Parent.Input)
local Park = require(script.Parent.Park)
local Vec = require(script.Parent.Vec)

local World = {}

-- A rider on the water at `pos`, moving at `vel`, with the handle in.
function World.createRider(cfg, pos, vel, heading)
	return {
		mode = "riding",
		pos = pos,
		vel = vel,
		heading = heading,
		stance = cfg.rider.stance,
		switchStance = false,
		edgeAngle = 0,
		edgeLoad = 0,
		ropeTension = 0,
		tensionSmooth = 0,
		tensionPeak = 0,
		tensionPeakAge = 0,
		tensionPrev = 0,
		tensionPrev2 = 0,
		ropeForce = Vec.vec3(),
		ropeHeading = heading,
		slackTime = 0,
		handle = "inFront",
		handleDist = cfg.posture.handleInDist,
		waistHinge = 0,
		connection = 1,
		legCompression = 0,
		popCharge = 0,
		blindTime = 0,
		spinOut = nil,
		blindDir = 0,
		air = nil,
		ramp = nil,
		jib = nil,
		crashTimer = 0,
		lastCrash = nil,
		modeTime = 0,
	}
end

-- Place the rider straight behind the carrier, rope almost tight, at carrier speed.
function World.spawnRiderBehindCarrier(state)
	local cfg, path, carrier = state.cfg, state.path, state.carrier
	local effective = (cfg.rope.length + cfg.posture.handleInDist) * cfg.run.respawnSlack
	local drop = cfg.cable.cableHeight - cfg.rider.hipHeight
	local back = math.sqrt(math.max(1, effective * effective - drop * drop))
	local behind = Cable.cablePointAt(path, carrier.s - back)
	local heading = carrier.heading
	local pos = Vec.vec3(behind.pos.x, 0, behind.pos.z)
	local vel = Vec.addScaled(Vec.vec3(), Vec.forwardOf(heading), cfg.cable.carrierSpeed)
	return World.createRider(cfg, pos, vel, heading)
end

function World.createSim(cfg, park, carrierStartS)
	cfg = cfg or Config.DEFAULT_CONFIG
	park = park or Park.DEFAULT_PARK
	carrierStartS = carrierStartS or park.startS or 30
	-- A park with its own cable (the beginner 2-tower system) rides on that.
	if park.cable then
		local merged = table.clone(cfg)
		merged.cable = table.clone(cfg.cable)
		for k, v in park.cable do
			merged.cable[k] = v
		end
		cfg = merged
	end
	local path = Cable.buildCablePath(cfg.cable)
	local carrier = Cable.createCarrier(path, carrierStartS, cfg.cable.carrierSpeed)
	return {
		tick = 0,
		time = 0,
		cfg = cfg,
		path = path,
		features = Park.resolvePark(park, path),
		carrier = carrier,
		rider = World.spawnRiderBehindCarrier({ cfg = cfg, path = path, carrier = carrier }),
		inputs = Input.createInputMemory(),
		events = {},
	}
end

return World
