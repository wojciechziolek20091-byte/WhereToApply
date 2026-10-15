-- Airborne integration, spins, inverts, grabs and raleys. Mirrors src/sim/air.ts.
local Config = require(script.Parent.Config)
local Edge = require(script.Parent.Edge)
local Scalar = require(script.Parent.Scalar)
local Vec = require(script.Parent.Vec)
local Posture = require(script.Parent.Posture)

local DT, GRAVITY = Config.DT, Config.GRAVITY
local Air = {}

function Air.approachOf(r, cfg)
	if Edge.edgeNorm(r, cfg.edge) < 0.2 then
		return "neutral"
	end
	return if r.edgeAngle > 0 then "heelside" else "toeside"
end

-- Snapshot the takeoff. Inverts and raleys are committed here.
function Air.createAirState(r, source, featureId, popSpeed, popQuality, edgeLoadAtBase, input, cfg)
	local cut = Edge.cutAngle(Vec.headingOf(r.vel), r.ropeHeading)
	local load = math.max(edgeLoadAtBase, r.edgeLoad)
	return {
		source = source,
		featureId = featureId,
		time = 0,
		takeoffPos = r.pos,
		takeoffHeading = Vec.headingOf(r.vel),
		approach = Air.approachOf(r, cfg),
		takeoffSwitch = r.switchStance,
		cutAtTakeoff = cut,
		edgeLoadAtTakeoff = load,
		tensionAtTakeoff = r.ropeTension,
		popSpeed = popSpeed,
		popQuality = popQuality,
		peakHeight = r.pos.y,
		passedPeak = false,
		spinAngle = 0,
		spinStarted = false,
		spunBeforePeak = false,
		flipDir = Scalar.sign(input.flip),
		flipAngle = 0,
		axis = if math.abs(cut) > cfg.air.rollAxisCut then "roll" else "flip",
		grab = nil,
		grabTime = 0,
		grabbed = nil,
		raleyEligible = load >= cfg.raley.minEdgeLoad and r.ropeTension >= cfg.raley.minTension,
		raleyExtension = 0,
		raleyPeak = 0,
	}
end

-- Handle in spins fast, handle out spins slow.
function Air.rotationFactor(r, cfg)
	local grabbing = r.air ~= nil and r.air.grab ~= nil
	return Scalar.lerp(1, cfg.air.handleOutRotation, Posture.handleNorm(r, cfg.posture)) * (if grabbing then 0.9 else 1)
end

local function airDrag(vel, cfg)
	return Vec.scale(vel, -cfg.air.dragCoef * Vec.length(vel))
end

function Air.stepAir(r, air, ropeForce, input, cfg)
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

	local rot = Air.rotationFactor(r, cfg)

	-- Spins: rotate while held. Starting before the peak costs height.
	if input.spin ~= 0 then
		if not air.spinStarted then
			air.spinStarted = true
			if not air.passedPeak and r.vel.y > 0.5 then
				air.spunBeforePeak = true
				r.vel = Vec.vec3(r.vel.x, r.vel.y * (1 - cfg.air.earlySpinPenalty), r.vel.z)
			end
		end
		-- +spin is frontside: chest opens toward travel, which is -toeSign in yaw.
		local frontside = -Edge.toeSign({ stance = r.stance, switchStance = air.takeoffSwitch })
		air.spinAngle += Scalar.sign(input.spin) * frontside * cfg.air.spinRate * rot * DT
	end

	-- Inverts: auto-rotate one full turn; holding the flip input keeps rotating.
	if air.flipDir ~= 0 then
		local keepGoing = Scalar.sign(input.flip) == air.flipDir
		if air.flipAngle < Scalar.TAU or keepGoing then
			air.flipAngle += cfg.air.invertRate * rot * DT
		end
	end

	-- Grabs: must be held long enough to count.
	if input.grab then
		if air.grab == input.grab then
			air.grabTime += DT
		else
			air.grab = input.grab
			air.grabTime = 0
		end
		if air.grabTime >= cfg.air.minGrabTime then
			air.grabbed = air.grab
		end
	else
		air.grab = nil
		air.grabTime = 0
	end

	-- Raley: swing the body up using the rope; must come back before landing.
	local raleyTarget = if air.raleyEligible and input.raley and r.hasHandle then 1 else 0
	air.raleyExtension = Scalar.approach(air.raleyExtension, raleyTarget, cfg.air.raleyRate * DT)
	air.raleyPeak = math.max(air.raleyPeak, air.raleyExtension)
end

return Air
