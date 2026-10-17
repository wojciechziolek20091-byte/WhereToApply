-- RiderAnimStateAdapter (spec section 0.2): fills the one table the animation
-- reads each frame (RiderAnimState) from the sim. Field names follow the spec;
-- `ext` carries the few extra values the animation needs. Vectors are plain
-- {x, y, z} tables and the board's rotation a {x, y, z, w} quaternion (convert
-- with CFrame only at the edge, in the client). Twin of src/anim/state.ts.
local Quat = require(script.Parent.Quat)
local Sim = require(script.Parent.Parent.Sim)
local RiderPose = require(script.Parent.Parent.RiderPose)

local DEG = Quat.DEG
local PI = math.pi
local Adapter = {}

local MODE = {
	riding = "Riding",
	ridingBlind = "RidingBlind",
	waterTrickLoad = "WaterTrickLoad",
	waterTrickAir = "WaterTrickAir",
	airborne = "Airborne",
	onKicker = "OnSafety",
	onSafety = "OnSafety",
	onFeature = "OnFeature",
	landing = "Landing",
	crashed = "Crashed",
}
local GRAB = { indy = "Indy", stalefish = "Stalefish", nose = "Nose", tail = "Tail" }
-- A lipslide faces the other way from the boardslide of its side.
local SLIDE = {
	fiftyFifty = "FiftyFifty",
	backboard = "Backboard",
	frontboard = "Frontboard",
	backLip = "Frontboard",
	frontLip = "Backboard",
	switchFiftyFifty = "SwitchFiftyFifty",
	wallRide = "WallRide",
}
local HANDLE = { inFront = "InFront", behind = "Behind", passing = "Passing", dropped = "Dropped" }

-- Board rotation from yaw, an optional invert (board-frame axis, angle) and the edge tilt.
function Adapter.composeBoardRotation(yaw, invertAxis, invertAngle, lean)
	local q = Quat.qaxis({ x = 0, y = 1, z = 0 }, -yaw)
	if invertAxis then
		q = Quat.qmul(q, Quat.qaxis(Quat.vnorm(invertAxis), invertAngle))
	end
	q = Quat.qmul(q, Quat.qaxis({ x = 1, y = 0, z = 0 }, lean))
	return Quat.qnorm(q)
end

function Adapter.boardRotation(r)
	local p = RiderPose.of(r)
	local ax = nil
	if p.invert then
		ax = { x = p.invert.axis[1], y = p.invert.axis[2], z = p.invert.axis[3] }
	end
	return Adapter.composeBoardRotation(p.yaw, ax, if p.invert then p.invert.angle else 0, p.lean)
end

local function nextMultiple(angle, step, dir)
	if dir > 0 then
		return math.ceil(angle / step - 1e-9) * step
	end
	return math.floor(angle / step + 1e-9) * step
end

local function sign(x)
	return if x > 0 then 1 elseif x < 0 then -1 else 0
end

local function trickId(r)
	local air = r.air
	if not air then
		return nil
	end
	local t = air.trick
	if t then
		if t.sBend ~= 0 then
			return if t.sBend < 0 then "SBendL" else "SBendR"
		end
		if t.kind ~= "raley" and math.abs(air.rot.spinAngle - air.spinStart) > 2.5 then
			return "Mobe"
		end
		return if t.kind == "raley" then "Raley" elseif t.kind == "backroll" then "Backroll" else "Frontroll"
	end
	if air.rot.flipAngle > 0.05 or (air.rot.flipRate > 0 and air.rot.flipAngle >= 0 and air.rot.flipTarget ~= nil) then
		return "FrontFlip"
	end
	if air.rot.flipAngle < -0.05 then
		return "Tantrum"
	end
	if math.abs(air.rot.spinAngle - air.spinStart) > 0.2 or air.rot.spinRate ~= 0 then
		return "Spin"
	end
	return "Ollie"
end

local function landingFrom(l)
	local q = nil
	if l.clean then
		q = "Clean"
	elseif l.quality < 0.75 then
		q = "Sketchy"
	end
	return { impactSpeed = l.impact, quality = q }
end

local function findFeature(sim, id)
	for _, f in sim.features do
		if f.def.id == id then
			return f
		end
	end
	return nil
end

-- The RiderAnimState for this frame. `events` are the tick's events (or all
-- since the last frame); `prev` keeps the landing info through the landing state.
function Adapter.fromSim(sim, events, prev)
	local r = sim.rider
	local cfg = sim.cfg
	local p = RiderPose.of(r)
	local air = r.air
	local g = Sim.Config.GRAVITY

	local airTime, airDuration = 0, 0
	if air and Sim.Fsm.inAir(r.mode) then
		airTime = air.time
		if air.trick then
			airDuration = math.max(air.trick.airtime, air.time + 1e-3)
		else
			local vy = r.vel.y
			local h = math.max(0, r.pos.y)
			airDuration = air.time + (vy + math.sqrt(vy * vy + 2 * g * h)) / g
		end
	end
	local phase = 0
	if air and air.trick then
		phase = air.trick.u
	elseif airDuration > 0 then
		phase = math.min(1, airTime / airDuration)
	end

	local spinRemaining, flipRemaining, spinDeg = 0, 0, 0
	if air then
		local rot = air.rot
		spinDeg = (rot.spinAngle - air.spinStart) / DEG
		local dir = if rot.spinRate ~= 0 then sign(rot.spinRate) else rot.spinDir
		if dir ~= 0 then
			local target = rot.spinTarget
			if target == nil then
				target = nextMultiple(rot.spinAngle - air.spinStart, PI, dir) + air.spinStart
			end
			spinRemaining = (target - rot.spinAngle) / DEG
		end
		local fd = if rot.flipRate ~= 0 then sign(rot.flipRate) else sign(rot.flipAngle)
		if fd ~= 0 then
			local target = rot.flipTarget
			if target == nil then
				target = nextMultiple(rot.flipAngle, 2 * PI, fd)
			end
			flipRemaining = (target - rot.flipAngle) / DEG
		end
	end

	local landing = nil
	local justLanded, justTookOff, ropeSnap = false, false, false
	for _, e in events do
		if e.type == "landed" then
			landing = landingFrom(e.landing)
			justLanded = true
		elseif e.type == "crash" and e.landing then
			landing = { impactSpeed = e.landing.impact, quality = nil }
			justLanded = true
		elseif e.type == "takeoff" then
			justTookOff = true
		elseif e.type == "ropeSnap" then
			ropeSnap = true
		end
	end
	if
		not landing
		and prev
		and prev.landing
		and (r.mode == "landing" or r.mode == "riding" or r.mode == "ridingBlind" or r.mode == "onFeature")
		and r.modeTime < 0.5
	then
		landing = prev.landing
	end

	local feature = nil
	local rail = false
	local wallRoll = 0
	local featureTurn = -1
	local slope = 0
	local jib = r.jib
	if jib then
		local f = findFeature(sim, jib.featureId)
		if f then
			local slide = Sim.OnFeature.slideIdAt(jib.boardAngle, f.heading, r.heading, r, jib)
			feature = { slide = SLIDE[slide], balance = jib.balance }
			-- Narrow mains (rails, pipes) look like rails; the old defs keep their style.
			if f.def.kind == "slider" then
				rail = f.def.style ~= "box"
			elseif f.def.kind == "feature" then
				for _, p in f.shape.pieces do
					if p.slide and p.width < 0.6 then
						rail = true
					end
				end
			end
			local wall = f.shape.pieces[1].wall
			if wall and r.ramp then
				-- On a wall ride: the board lies on the wall, rolled by the profile's angle.
				local x = (r.ramp.v - wall.base) * wall.side
				wallRoll = -wall.side * p.toes * math.atan(Sim.FeatureShapes.wallHeightAt(wall, math.max(x, 0)).slope)
				feature = { slide = "WallRide", balance = 0 }
			end
		end
		if jib.targetAngle ~= jib.boardAngle then
			featureTurn = 1 - math.min(1, math.abs(jib.targetAngle - jib.boardAngle) / (PI / 2))
		end
	end
	if r.ramp then
		local f = findFeature(sim, r.ramp.featureId)
		if f then
			slope = math.atan2(math.max(0, r.vel.y), math.max(0.1, math.sqrt(r.vel.x * r.vel.x + r.vel.z * r.vel.z))) / DEG
		end
	end

	local hip = { x = r.pos.x, y = r.pos.y + cfg.rider.hipHeight * (1 - 0.35 * r.legCompression), z = r.pos.z }
	local toCarrier = Quat.vsub(sim.carrier.pos, hip)
	local dist = Quat.vlen(toCarrier)
	local dir = if dist > 1e-6 then Quat.vnorm(toCarrier) else { x = 1, y = 0, z = 0 }
	local handlePosition = { x = hip.x + dir.x * r.handleDist, y = hip.y + dir.y * r.handleDist, z = hip.z + dir.z * r.handleDist }

	local mem = sim.inputs
	local charging = r.popCharge > 0 and (r.mode == "riding" or r.mode == "waterTrickLoad" or r.mode == "ridingBlind")
	local t = if air then air.trick else nil
	local rotSide = if air then air.rot.spinSide else nil
	local rollKind = nil
	if t and t.kind == "backroll" then
		rollKind = "back"
	elseif t and t.kind == "frontroll" then
		rollKind = "front"
	end

	return {
		state = MODE[r.mode],
		stance = if r.stance == "regular" then "Regular" else "Goofy",
		isSwitch = if air then air.takeoffSwitch else r.switchStance,
		speed = math.sqrt(r.vel.x * r.vel.x + r.vel.z * r.vel.z),
		velocity = table.clone(r.vel),
		edge = math.max(-1, math.min(1, r.edgeAngle / cfg.edge.maxEdgeAngle)),
		tension = r.tensionSmooth,
		popCharge = r.popCharge,
		boardCFrame = {
			pos = table.clone(r.pos),
			rot = if wallRoll == 0 then Adapter.boardRotation(r) else Adapter.composeBoardRotation(p.yaw, nil, 0, p.lean + wallRoll),
		},
		handlePosition = handlePosition,
		trick = {
			id = trickId(r),
			phase = phase,
			spinDegrees = spinDeg,
			spinDirection = if rotSide == "frontside" then "Frontside" elseif rotSide == "backside" then "Backside" else nil,
			flipDegrees = if air then air.rot.flipAngle / DEG else 0,
			grab = if air and air.grab then GRAB[air.grab] else nil,
			grabTime = if air and air.grab then air.grabTimes[air.grab] else 0,
		},
		handle = HANDLE[r.handle],
		passProgress = if air and air.rot.passTimer > 0 then 1 - air.rot.passTimer / cfg.handlePass.passTime else nil,
		feature = feature,
		landing = landing,
		crashReason = if r.mode == "crashed" then r.lastCrash else nil,
		ext = {
			toes = p.toes,
			carrier = table.clone(sim.carrier.pos),
			airTime = airTime,
			airDuration = airDuration,
			spinRate = if air then air.rot.spinRate / DEG else 0,
			spinRemaining = spinRemaining,
			flipRemaining = flipRemaining,
			preWind = if charging then mem.steerDir else 0,
			extension = if t then t.extension / DEG else 0,
			rollDegrees = if t then t.rollAngle / DEG else 0,
			sBend = if t then t.sBend else 0,
			rollKind = rollKind,
			edgeDegrees = r.edgeAngle / DEG,
			slope = slope,
			rail = rail,
			featureTurn = featureTurn,
			lipPop = air ~= nil and air.lipPop == true,
			modeTime = r.modeTime,
			justLanded = justLanded,
			justTookOff = justTookOff,
			ropeSnap = ropeSnap,
			spinOut = if r.spinOut then r.spinOut.dir else 0,
		},
	}
end

return Adapter
