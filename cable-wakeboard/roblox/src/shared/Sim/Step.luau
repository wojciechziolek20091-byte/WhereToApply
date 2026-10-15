-- One fixed tick of the sim, dispatching on rider.mode. Mirrors src/sim/step.ts.
local Actions = require(script.Parent.Actions)
local Air = require(script.Parent.Air)
local Cable = require(script.Parent.Cable)
local Config = require(script.Parent.Config)
local Edge = require(script.Parent.Edge)
local Hydro = require(script.Parent.Hydro)
local OnFeature = require(script.Parent.OnFeature)
local Pop = require(script.Parent.Pop)
local Posture = require(script.Parent.Posture)
local Vec = require(script.Parent.Vec)

local DT, GRAVITY = Config.DT, Config.GRAVITY
local Step = {}

-- On the water: rope, planing forces, edge and heading.
local function stepRiding(s, input)
	local rider, cfg = s.rider, s.cfg
	local m = cfg.rider.mass
	local released = Actions.popReleased(s, input)
	local compression = rider.legCompression
	Posture.updatePosture(rider, input.handleIn, input.load, rider.ropeTension, cfg.posture, DT)
	Edge.updateEdge(rider, if rider.hasHandle then input.edge else 0, cfg.edge, DT)

	local rope = Actions.applyRope(s)
	local hydro = Hydro.computeHydroForces(rider.vel, rider.heading, Edge.edgeNorm(rider, cfg.edge), cfg.hydro)
	rider.edgeLoad = hydro.edgeLoad
	Pop.updateLoadTracker(rider.load, rider.edgeLoad, cfg.pop, DT)

	local horizontalForce = Vec.add(Vec.vec3(rope.force.x, 0, rope.force.z), hydro.force)
	rider.vel = Vec.addScaled(rider.vel, Vec.scale(horizontalForce, 1 / m), DT)
	rider.vel = Vec.vec3(rider.vel.x, 0, rider.vel.z)
	rider.pos = Vec.addScaled(rider.pos, rider.vel, DT)
	rider.pos = Vec.vec3(rider.pos.x, 0, rider.pos.z)
	Edge.updateHeading(rider, rider.ropeHeading, rope.tension, Vec.horizontalLength(rider.vel), cfg.edge, DT)
	rider.loadHeld = input.load

	if released then
		-- Releasing on flat water, including just before a feature: popping too early.
		local pop = Pop.computePop(
			Pop.flatPopInputs(rider.load, rider.edgeLoad, rope.tension, rider.connection, compression, cfg.pop),
			cfg.pop
		)
		Actions.takeOff(s, "flat", nil, pop.speed, pop.quality, rider.load.peakEdgeLoad, input)
		return
	end
	if OnFeature.tryEnterFeature(s) then
		return
	end
	if not input.load and rope.force.y > m * GRAVITY * cfg.hydro.liftOffFactor then
		-- A loading rider is pressing into the water; otherwise a big pull lifts them off.
		Actions.takeOff(s, "lineLift", nil, 0, 0, rider.load.peakEdgeLoad, input)
	end
end

local function stepAirborne(s, input)
	local rider, cfg = s.rider, s.cfg
	local air = rider.air
	assert(air, "air mode without AirState")
	Posture.updatePosture(rider, input.handleIn, input.load, rider.ropeTension, cfg.posture, DT)
	Edge.updateEdge(rider, 0, cfg.edge, DT)
	rider.edgeLoad = 0
	rider.extendTimer = math.max(0, rider.extendTimer - DT)
	local rope = Actions.applyRope(s)
	Air.stepAir(rider, air, rope.force, input, cfg)
	rider.loadHeld = input.load
	if OnFeature.touchDownOnFeature(s, air) then
		return
	end
	if rider.pos.y <= 0 and rider.vel.y < 0 then
		Actions.touchDown(s, air, Vec.UP, 0)
	end
end

local function stepFallen(s)
	local rider, cfg = s.rider, s.cfg
	rider.vel = Vec.addScaled(rider.vel, Vec.scale(rider.vel, -cfg.hydro.fallenDrag / cfg.rider.mass), DT)
	rider.pos = Vec.addScaled(rider.pos, rider.vel, DT)
	rider.fallTimer = math.max(0, rider.fallTimer - DT)
	rider.ropeTension = 0
	rider.ropeForce = Vec.vec3()
	rider.edgeLoad = 0
end

-- Advance the whole sim by one fixed tick. Deterministic: depends only on state and input.
function Step.stepSim(s, input)
	s.events = {}
	Cable.stepCarrier(s.carrier, s.path, s.cfg.cable.carrierSpeed, DT)
	local rider = s.rider
	local mode = rider.mode
	if mode == "riding" then
		stepRiding(s, input)
	elseif mode == "air" then
		stepAirborne(s, input)
	elseif mode == "feature" then
		OnFeature.stepFeature(s, input)
	elseif mode == "fallen" then
		stepFallen(s)
	end
	-- Losing the handle on the water or a feature is an immediate fall; in the
	-- air it is judged on touchdown.
	if rider.mode ~= "fallen" and Actions.checkGrip(s, input) and rider.mode ~= "air" then
		Actions.fallRider(s, "droppedHandle")
	end
	rider.modeTime += DT
	s.tick += 1
	s.time = s.tick * DT
end

Step.hipPosition = Actions.hipPosition
Step.takeOff = Actions.takeOff

return Step
