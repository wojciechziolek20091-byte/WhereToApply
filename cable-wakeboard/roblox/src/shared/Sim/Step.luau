-- One fixed tick of the sim, dispatching on rider.mode. Mirrors src/sim/step.ts.
local Actions = require(script.Parent.Actions)
local Air = require(script.Parent.Air)
local Cable = require(script.Parent.Cable)
local Config = require(script.Parent.Config)
local Edge = require(script.Parent.Edge)
local FeatureRideApproachTracker = require(script.Parent.FeatureRideApproachTracker)
local FeatureRideEntryResolver = require(script.Parent.FeatureRideEntryResolver)
local FeatureRideExitResolver = require(script.Parent.FeatureRideExitResolver)
local FeatureRideFeatureSpecials = require(script.Parent.FeatureRideFeatureSpecials)
local FeatureRideSlideOn = require(script.Parent.FeatureRideSlideOn)
local Fsm = require(script.Parent.Fsm)
local Hydro = require(script.Parent.Hydro)
local Input = require(script.Parent.Input)
local OnFeature = require(script.Parent.OnFeature)
local Pop = require(script.Parent.Pop)
local Scalar = require(script.Parent.Scalar)
local Posture = require(script.Parent.Posture)
local Vec = require(script.Parent.Vec)
local WaterTrick = require(script.Parent.WaterTrick)

local DT, GRAVITY = Config.DT, Config.GRAVITY
local Step = {}

Step.hipPosition = Actions.hipPosition
Step.takeOff = Actions.takeOff

-- On the water: riding, riding blind, loaded, or the landing grace.
local function stepWater(s, input)
	local r, cfg = s.rider, s.cfg
	local mem = s.inputs
	local m = cfg.rider.mass
	local blind = r.mode == "ridingBlind"

	if blind and not r.spinOut and not mem.popReleased then
		r.blindTime += DT
		local pressed = mem.steerDir ~= 0 and mem.steerHeldTime == 0
		if pressed and mem.steerDir == -r.blindDir then
			r.spinOut = { time = cfg.blind.spinOutTime, dir = mem.steerDir }
		elseif pressed or r.blindTime > cfg.blind.maxRideTime then
			Actions.crash(s, "caughtEdgeBlind")
			return
		end
	end

	local steer = if blind then input.steer * cfg.blind.steerFactor else input.steer
	local edgeLimit = if blind then cfg.blind.maxEdge else 1
	local request = 0
	if not (r.mode == "landing" or r.handle == "dropped") then
		request = math.max(-edgeLimit, math.min(edgeLimit, Edge.carveToEdge(r, steer)))
	end
	Posture.updatePosture(r, if input.armsOut then 0 else 1, input.pop, r.ropeTension, cfg.posture, DT)
	Edge.updateEdge(r, request, cfg.edge, DT)
	local rope = Actions.applyRope(s)
	if not rope then
		return
	end
	local hydro = Hydro.computeHydroForces(r.vel, r.heading, Edge.edgeNorm(r, cfg.edge), cfg.hydro)
	r.edgeLoad = hydro.edgeLoad
	local horizontalForce = Vec.add(Vec.vec3(rope.force.x, 0, rope.force.z), hydro.force)
	r.vel = Vec.addScaled(r.vel, Vec.scale(horizontalForce, 1 / m), DT)
	r.vel = Vec.vec3(r.vel.x, 0, r.vel.z)
	r.pos = Vec.addScaled(r.pos, r.vel, DT)
	r.pos = Vec.vec3(r.pos.x, 0, r.pos.z)
	Edge.updateHeading(r, r.ropeHeading, rope.tension, Vec.horizontalLength(r.vel), cfg.edge, DT)
	FeatureRideApproachTracker.trackApproach(s)
	if input.pop then
		r.popCharge = Pop.ollieCharge(mem.popHeldTime, cfg)
	end

	if r.spinOut then
		r.spinOut.time -= DT
		if r.spinOut.time <= 0 then
			r.spinOut = nil
			r.switchStance = not r.switchStance
			r.handle = "inFront"
			r.blindDir = 0
			Fsm.transition(s, "riding", "spinOut")
			table.insert(s.events, { type = "blindSpinOut", tick = s.tick })
		end
		return
	end

	if r.mode == "landing" then
		if r.modeTime >= cfg.landing.graceTime then
			Fsm.transition(s, if r.handle == "behind" then "ridingBlind" else "riding", "graceOver")
		else
			return
		end
	end

	if mem.popReleased then
		local charge = Pop.ollieCharge(mem.popHeldTime, cfg)
		if r.mode == "waterTrickLoad" then
			local vy, trick = WaterTrick.planWaterTrick(r.tensionSmooth, Pop.waterTrickTiming(r, cfg, DT), input, cfg)
			local air = Actions.takeOff(s, "waterTrick", nil, vy, trick.timing)
			air.trick = trick
			return
		end
		local air = Actions.takeOff(s, if r.mode == "ridingBlind" then "blindPop" else "flat", nil, Pop.ollieSpeed(charge, cfg), charge)
		FeatureRideEntryResolver.startEntry(s, air, Scalar.sign(input.steer), charge)
		FeatureRideSlideOn.predictSlideOn(s, air, Pop.ollieSpeed(charge, cfg))
		return
	end
	if r.mode == "riding" and WaterTrick.canArm(r, cfg) then
		Fsm.transition(s, "waterTrickLoad", "loaded")
	elseif r.mode == "waterTrickLoad" and WaterTrick.shouldDisarm(r, cfg) then
		Fsm.transition(s, "riding", "unloaded")
	end

	if OnFeature.tryEnterFeature(s) then
		return
	end
	if not input.pop and rope.force.y > m * GRAVITY * cfg.hydro.liftOffFactor and r.mode ~= "ridingBlind" then
		Actions.takeOff(s, "lineLift", nil, 0, 0)
	end
end

local function stepAirborne(s, input)
	local r, cfg = s.rider, s.cfg
	local air = r.air
	if not air then
		error("air mode without AirState")
	end
	Posture.updatePosture(r, if input.armsOut then 0 else 1, false, r.ropeTension, cfg.posture, DT)
	Edge.updateEdge(r, 0, cfg.edge, DT)
	r.edgeLoad = 0
	local rope = Actions.applyRope(s)
	if not rope then
		return
	end
	-- A slide-on climbing over the side edge instead of flying.
	if OnFeature.stepSlideOnContact(s, air, input) then
		return
	end
	if Air.stepAir(r, air, rope.force, input, s.inputs, cfg) then
		table.insert(s.events, { type = "handlePass", tick = s.tick })
	end
	FeatureRideExitResolver.stepExitAssist(s, air, input)
	FeatureRideSlideOn.stepNoseLift(s, air, input)
	local lead = FeatureRideSlideOn.leadCrossing(s, air)
	if lead == "noseDig" or lead == "hangUp" then
		Actions.crash(s, lead)
		return
	end
	if lead == "contact" then
		return
	end
	if OnFeature.airOverFeature(s, air) then
		return
	end
	if r.pos.y <= 0 and r.vel.y < 0 then
		local spine = FeatureRideFeatureSpecials.spineFlatLanding(s, air)
		if FeatureRideEntryResolver.landedInGap(s, air) then
			Actions.crash(s, "landedInGap")
		elseif spine == "hard" then
			Actions.crash(s, "hardLanding")
		else
			local landing = Actions.touchDown(s, air, Vec.UP, 0)
			if spine == "flat" then
				FeatureRideFeatureSpecials.markSpineFlat(landing)
			end
		end
	end
end

local function stepCrashed(s)
	local r, cfg = s.rider, s.cfg
	r.vel = Vec.addScaled(r.vel, Vec.scale(r.vel, -cfg.hydro.fallenDrag / cfg.rider.mass), DT)
	r.pos = Vec.addScaled(r.pos, r.vel, DT)
	r.crashTimer = math.max(0, r.crashTimer - DT)
	r.ropeTension = 0
	r.ropeForce = Vec.vec3()
	r.edgeLoad = 0
end

-- Advance the whole sim by one fixed tick.
function Step.stepSim(s, input)
	s.events = {}
	Input.updateInputMemory(s.inputs, input, s.cfg, DT)
	Cable.stepCarrier(s.carrier, s.path, s.cfg.cable.carrierSpeed, DT)
	local r = s.rider
	local mode = r.mode
	if Fsm.onWater(mode) then
		stepWater(s, input)
	elseif Fsm.inAir(mode) then
		stepAirborne(s, input)
	elseif mode == "onKicker" or mode == "onSafety" then
		OnFeature.stepRamp(s, input, s.inputs)
	elseif mode == "onFeature" then
		OnFeature.stepSlide(s, input, s.inputs)
	else
		stepCrashed(s)
	end

	if input.letGo and r.handle ~= "dropped" and r.mode ~= "crashed" then
		if Fsm.inAir(r.mode) then
			r.handle = "dropped"
		else
			Actions.crash(s, "letGo")
		end
	end
	r.modeTime += DT
	s.tick += 1
	s.time = s.tick * DT
end

return Step
