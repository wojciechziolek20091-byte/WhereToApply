-- Air: flight, spins, flips, grabs, handle passes, water tricks. Mirrors src/sim/air.ts.
local BodyPhysics = require(script.Parent.BodyPhysics)
local Config = require(script.Parent.Config)
local Edge = require(script.Parent.Edge)
local Handle = require(script.Parent.Handle)
local Rotation = require(script.Parent.Rotation)
local Vec = require(script.Parent.Vec)
local WaterTrick = require(script.Parent.WaterTrick)

local DT, GRAVITY = Config.DT, Config.GRAVITY
local Air = {}

function Air.passWindowFor(source, cfg)
	local hp = cfg.handlePass
	if source == "kicker" then
		return hp.kickerWindow
	end
	if source == "feature" then
		return hp.obstacleAirWindow
	end
	if source == "waterTrick" then
		return hp.waterTrickWindow
	end
	return hp.flatAirWindow
end

function Air.createAirState(r, source, featureId, popSpeed, popQuality, cfg, spinStart)
	spinStart = spinStart or 0
	local rot = Rotation.createRotation(Air.passWindowFor(source, cfg))
	rot.spinAngle = spinStart
	local fromBlind = source == "blindPop"
	if fromBlind then
		rot.spinSide = "backside"
		rot.startDir = r.blindDir
		rot.spinDir = r.blindDir
		rot.progressOffset = math.pi
		rot.zonesResolved = 1
		rot.stoppedByRope = true
		rot.blindDir = r.blindDir
	end
	return {
		source = source,
		featureId = featureId,
		time = 0,
		takeoffPos = r.pos,
		takeoffHeading = Vec.headingOf(r.vel),
		takeoffSwitch = r.switchStance,
		tensionAtTakeoff = r.ropeTension,
		popSpeed = popSpeed,
		popQuality = popQuality,
		peakHeight = r.pos.y,
		passedPeak = false,
		spinStart = spinStart,
		rot = rot,
		grab = nil,
		grabTimes = { indy = 0, stalefish = 0, nose = 0, tail = 0 },
		trick = nil,
		fromBlind = fromBlind,
		lipPop = false,
		overFeature = nil,
		preWind = 0,
	}
end

local function airDrag(vel, cfg)
	return Vec.scale(vel, -cfg.air.dragCoef * Vec.length(vel))
end

-- One airborne tick. Returns true if a handle pass was made this tick.
function Air.stepAir(r, air, ropeForce, input, mem, cfg)
	local m = cfg.rider.mass
	local force = Vec.add(Vec.add(Vec.vec3(0, -GRAVITY * m, 0), ropeForce), airDrag(r.vel, cfg))
	r.vel = Vec.addScaled(r.vel, force, DT / m)
	r.pos = Vec.addScaled(r.pos, r.vel, DT)
	if Vec.horizontalLength(r.vel) > 0.5 then
		r.heading = Vec.headingOf(r.vel)
	end

	air.time += DT
	air.peakHeight = math.max(air.peakHeight, r.pos.y)
	if not air.passedPeak and r.vel.y <= 0 then
		air.passedPeak = true
	end

	local steerForSpin = if air.trick then WaterTrick.stepWaterTrick(air.trick, input, mem, cfg) else mem.steerDir
	local toes = Edge.toeSign({ stance = r.stance, switchStance = air.takeoffSwitch })
	local boardYaw = r.heading + air.rot.spinAngle
	-- Section 11: tuck sets the rate within a turn; a pre-wound spin is faster.
	local spinDir = if steerForSpin ~= 0 then steerForSpin else air.rot.spinDir
	local spinRate = cfg.spin.rate * BodyPhysics.spinRateScale(cfg, air.rot) * BodyPhysics.preWindScale(cfg, air.preWind, spinDir)
	Rotation.stepSpin(air.rot, steerForSpin, function()
		return Rotation.rotationSide(steerForSpin, boardYaw, toes, r.ropeHeading)
	end, cfg, DT, spinRate)
	if not air.trick then
		Rotation.stepFlip(air.rot, if input.forward then 1 elseif input.back then -1 else 0, cfg, DT, BodyPhysics.flipRateScale(cfg, air.rot.flipAngle))
	end

	air.grab = mem.grabChoice
	if air.grab then
		air.grabTimes[air.grab] += DT
	end

	local handle, result = Handle.updateHandle(r.handle, air.rot, mem.passPressed, { rate = cfg.spin.rate, inAir = true }, cfg, DT)
	r.handle = handle
	return result.passed
end

return Air
