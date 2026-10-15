-- AnimTestDriver (spec section 0.2): plays any trick on demand along a
-- scripted arc, so each animation can be checked frozen at any phase (the
-- pose scrubber) without the gameplay. Twin of src/anim/testDriver.ts.
local Adapter = require(script.Parent.RiderAnimStateAdapter)
local Animator = require(script.Parent.Animator)
local Quat = require(script.Parent.Quat)

local DEG = Quat.DEG
local compose = Adapter.composeBoardRotation
local Driver = {}

local SPEED = 8.3
local function s01(x)
	return if x < 0 then 0 elseif x > 1 then 1 else x
end
local function smooth(x)
	local t = s01(x)
	return t * t * (3 - 2 * t)
end

function Driver.baseAnimState(origin)
	return {
		state = "Riding",
		stance = "Regular",
		isSwitch = false,
		speed = SPEED,
		velocity = { x = SPEED, y = 0, z = 0 },
		edge = 0,
		tension = 420,
		popCharge = 0,
		boardCFrame = { pos = table.clone(origin), rot = compose(0, nil, 0, 0) },
		handlePosition = Quat.vadd(origin, { x = 0.4, y = 1, z = 0 }),
		trick = { id = nil, phase = 0, spinDegrees = 0, spinDirection = nil, flipDegrees = 0, grab = nil, grabTime = 0 },
		handle = "InFront",
		passProgress = nil,
		feature = nil,
		landing = nil,
		crashReason = nil,
		ext = {
			toes = 1,
			carrier = Quat.vadd(origin, { x = 16, y = 6.5, z = 1.5 }),
			airTime = 0,
			airDuration = 0,
			spinRate = 0,
			spinRemaining = 0,
			flipRemaining = 0,
			preWind = 0,
			extension = 0,
			rollDegrees = 0,
			sBend = 0,
			rollKind = nil,
			edgeDegrees = 0,
			slope = 0,
			rail = false,
			featureTurn = -1,
			lipPop = false,
			modeTime = 0,
			justLanded = false,
			justTookOff = false,
			ropeSnap = false,
			spinOut = 0,
		},
	}
end
local base = Driver.baseAnimState

local function air(s, u, h, T, id)
	local water = id == "Raley" or id == "Backroll" or id == "Frontroll" or id == "SBendL" or id == "SBendR" or id == "Mobe"
	s.state = if water then "WaterTrickAir" else "Airborne"
	s.boardCFrame.pos.y += 4 * h * u * (1 - u)
	s.velocity = { x = SPEED, y = ((4 * h) / T) * (1 - 2 * u), z = 0 }
	s.trick.id = id
	s.trick.phase = u
	s.ext.airTime = u * T
	s.ext.airDuration = T
	s.tension = 150
end

local function flip(dir, h, T)
	return {
		duration = T,
		at = function(u, _p, o)
			local s = base(o)
			air(s, u, h, T, if dir > 0 then "FrontFlip" else "Tantrum")
			local prog = smooth((u - 0.08) / 0.7)
			local deg = 360 * prog * dir
			s.trick.flipDegrees = deg
			s.ext.flipRemaining = if prog >= 1 then 0 else (360 - math.abs(deg)) * dir
			s.boardCFrame.rot = compose(0, { x = 1, y = 0, z = 0 }, deg * DEG, 0)
			return s
		end,
	}
end

local function spin(deg, h, T, pass)
	return {
		duration = T,
		at = function(u, p, o)
			local s = base(o)
			air(s, u, h, T, "Spin")
			local k = smooth((u - 0.05) / 0.8)
			local k0 = smooth((p - 0.05) / 0.8)
			local a = deg * k
			s.trick.spinDegrees = a
			s.trick.spinDirection = "Backside"
			s.ext.spinRate = if u > 0 then ((deg * (k - k0)) / math.max(1e-6, u - p)) / T else 0
			s.ext.spinRemaining = deg - a
			s.boardCFrame.rot = compose(a * DEG, nil, 0, 0)
			if pass and math.abs(a) > 150 and math.abs(a) < 250 then
				s.handle = "Passing"
				s.passProgress = (math.abs(a) - 150) / 100
			end
			return s
		end,
	}
end

local function raleyExtension(u)
	if u < 0.15 then
		return (u / 0.15) * 25
	elseif u < 0.55 then
		return 25 + ((u - 0.15) / 0.4) * 65
	elseif u < 0.85 then
		return 90 - ((u - 0.55) / 0.3) * 80
	end
	return 10 * (1 - (u - 0.85) / 0.15)
end

local H = math.sqrt(0.5)

local function waterTrick(id)
	local T = 1.5
	return {
		duration = T,
		at = function(u, _p, o)
			local s = base(o)
			air(s, u, 2.5, T, id)
			s.tension = 1300 * (1 - u)
			s.ext.carrier = Quat.vadd(o, { x = 11, y = 6.5, z = 10 })
			s.ext.edgeDegrees = 30 * (1 - smooth(u / 0.3))
			if id == "Raley" or id == "SBendL" or id == "SBendR" then
				s.ext.extension = raleyExtension(u)
				if id ~= "Raley" then
					if u < 0.3 then
						s.trick.id = "Raley"
					else
						local side = if id == "SBendL" then -1 else 1
						s.ext.sBend = side
						local roll = 360 * smooth((u - 0.3) / 0.5)
						s.ext.rollDegrees = roll
						s.boardCFrame.rot = compose(0, { x = H, y = 0, z = H }, side * roll * DEG, 0)
					end
				end
				return s
			end
			local backR = id == "Backroll" or id == "Mobe"
			s.ext.rollKind = if backR then "back" else "front"
			local roll = 360 * smooth((u - 0.08) / 0.72)
			s.ext.rollDegrees = roll
			local yaw = 0
			if id == "Mobe" then
				local k = smooth((u - 0.1) / 0.7)
				yaw = 360 * k * DEG
				s.trick.spinDegrees = 360 * k
				s.ext.spinRate = if u > 0.1 and u < 0.8 then 360 / (0.7 * T) else 0
				s.ext.spinRemaining = 360 * (1 - k)
			end
			s.boardCFrame.rot = compose(yaw, { x = H, y = H, z = 0 }, (if backR then -1 else 1) * roll * DEG, 0)
			return s
		end,
	}
end

local function grab(g)
	local T = 1.4
	return {
		duration = T,
		at = function(u, _p, o)
			local s = base(o)
			air(s, u, 1.6, T, "Ollie")
			if u > 0.18 and u < 0.78 then
				s.trick.grab = g
				s.trick.grabTime = (u - 0.18) * T
			end
			return s
		end,
	}
end

local function riding(edge, tension, extra)
	return {
		duration = 1.5,
		at = function(u, _p, o)
			local s = base(o)
			s.edge = edge
			s.ext.edgeDegrees = edge * 40
			s.tension = tension
			s.boardCFrame.rot = compose(0, nil, 0, -edge * 40 * DEG)
			s.velocity = { x = SPEED, y = 0, z = -edge * 3 }
			if extra then
				extra(s, u)
			end
			return s
		end,
	}
end

local function slide(name)
	local yaw = if name == "Backboard" then -90 elseif name == "Frontboard" then 90 elseif name == "SwitchFiftyFifty" then 180 else 0
	return {
		duration = 2,
		at = function(u, _p, o)
			local s = base(o)
			s.state = "OnFeature"
			s.boardCFrame.pos.y += 0.6
			s.boardCFrame.rot = compose(yaw * DEG, nil, 0, 0)
			s.feature = { slide = name, balance = 0.75 * math.sin(2 * math.pi * u) }
			s.ext.rail = true
			s.tension = 300
			return s
		end,
	}
end

local function crash(reason)
	return {
		duration = 2.2,
		at = function(u, _p, o)
			local s = base(o)
			s.state = "Crashed"
			s.crashReason = reason
			s.handle = "Dropped"
			s.tension = 0
			s.speed = SPEED * (1 - u)
			s.velocity = { x = SPEED * (1 - u), y = 0, z = 0 }
			s.ext.modeTime = u * 2.2
			return s
		end,
	}
end

local function landing(impact, quality)
	return {
		duration = 0.8,
		at = function(u, p, o)
			local s = base(o)
			s.state = if u < 0.25 then "Landing" else "Riding"
			s.ext.justLanded = p <= 0 and u > 0
			s.landing = { impactSpeed = impact, quality = quality }
			return s
		end,
	}
end

-- Name -> scenario, and the names in order (the scrubber's list).
Driver.ORDER = {}
Driver.SCENARIOS = {}
local function add(name, sc)
	table.insert(Driver.ORDER, name)
	Driver.SCENARIOS[name] = sc
end

add("Cruise", riding(0, 420))
add("Heelside", riding(1, 950))
add("Toeside", riding(-1, 750))
add("Loaded", riding(1, 1350, function(s)
	s.state = "WaterTrickLoad"
end))
add("Charge", riding(0.4, 600, function(s, u)
	s.popCharge = s01(u * 1.5)
end))
add("PreWind", riding(0.6, 700, function(s, u)
	s.popCharge = s01(u * 1.5)
	s.ext.preWind = 1
end))
add("Blind", riding(0, 500, function(s)
	s.state = "RidingBlind"
	s.handle = "Behind"
	s.boardCFrame.rot = compose(math.pi, nil, 0, 0)
end))
add("Slack", riding(0, 0))
add("Ollie", {
	duration = 1.1,
	at = function(u, _p, o)
		local s = base(o)
		air(s, u, 1, 1.1, "Ollie")
		return s
	end,
})
add("Spin360", spin(360, 1.6, 1.4, false))
add("Spin540", spin(540, 1.9, 1.5, false))
add("HandlePass", spin(360, 1.6, 1.4, true))
add("FrontFlip", flip(1, 2, 1.5))
add("Tantrum", flip(-1, 2, 1.5))
add("Raley", waterTrick("Raley"))
add("Backroll", waterTrick("Backroll"))
add("Frontroll", waterTrick("Frontroll"))
add("SBendL", waterTrick("SBendL"))
add("SBendR", waterTrick("SBendR"))
add("Mobe", waterTrick("Mobe"))
add("Indy", grab("Indy"))
add("Stalefish", grab("Stalefish"))
add("Nose", grab("Nose"))
add("Tail", grab("Tail"))
add("FiftyFifty", slide("FiftyFifty"))
add("Backboard", slide("Backboard"))
add("Frontboard", slide("Frontboard"))
add("SwitchFiftyFifty", slide("SwitchFiftyFifty"))
add("Landing", landing(6, "Clean"))
add("SketchyLanding", landing(7, "Sketchy"))
add("CrashShortOllie", crash("shortOllie"))
add("CrashHandleDropped", crash("handleDropped"))
add("CrashUnderRotated", crash("underRotated"))
add("CrashRaleyExtended", crash("raleyExtendedOnLanding"))
add("CrashGrabHeld", crash("grabHeldOnLanding"))
add("CrashCaughtEdgeBlind", crash("caughtEdgeBlind"))
add("CrashFellOffFeature", crash("fellOffFeature"))
add("CrashRopeYank", crash("ropeYank"))

-- Play a scenario from its start up to phase u at fps; returns the last frame.
function Driver.playTo(a, sc, u, origin, fps)
	fps = fps or 60
	local steps = math.max(1, math.round(sc.duration * s01(u) * fps))
	local dt = 1 / fps
	local frame = Animator.step(a, sc.at(0, 0, origin), dt)
	for _ = 1, 20 do
		frame = Animator.step(a, sc.at(0, 0, origin), dt)
	end
	local prev = 0
	for i = 1, steps do
		local t = (i / steps) * s01(u)
		frame = Animator.step(a, sc.at(t, prev, origin), dt)
		prev = t
	end
	return frame
end

return Driver
