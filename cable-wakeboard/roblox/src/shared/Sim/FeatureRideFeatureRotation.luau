-- Twin of src/sim/featureRide/featureRotation.ts (FeatureRotation, feature
-- riding spec 5.2-5.4): slide names by approach side and the chest rule, and
-- 90-degree hop steps on the feature (chained rotations, hard way, handle pass).
local Config = require(script.Parent.Config)
local DetMath = require(script.Parent.DetMath)
local Edge = require(script.Parent.Edge)
local Handle = require(script.Parent.Handle)
local Rotation = require(script.Parent.Rotation)
local Scalar = require(script.Parent.Scalar)
local SlideController = require(script.Parent.FeatureRideSlideController)
local Vec = require(script.Parent.Vec)

local DT = Config.DT
local FeatureRotation = {}

function FeatureRotation.slideSide(id)
	if id == "backboard" or id == "backLip" then
		return "backside"
	elseif id == "frontboard" or id == "frontLip" then
		return "frontside"
	end
	return nil
end

function FeatureRotation.sideEntrySlide(boardYaw, featureHeading, fromSide, toes, takeoffHeading)
	local across = Vec.rightOf(featureHeading)
	local toward = Vec.vec3(-fromSide * across.x, 0, -fromSide * across.z)
	local toeDir = Vec.rightOf(takeoffHeading)
	local frontside = Vec.dot(toeDir, toward) * toes > 0
	local lip = Vec.dot(Vec.forwardOf(boardYaw), toward) < 0
	if lip then
		return if frontside then "frontLip" else "backLip"
	end
	return if frontside then "frontboard" else "backboard"
end

function FeatureRotation.slideIdAt(boardAngle, featureHeading, travelHeading, r, j)
	local k = Scalar.round(boardAngle / (math.pi / 2))
	local m = Scalar.mod(k, 4)
	if m == 0 then
		return if r.switchStance then "switchFiftyFifty" else "fiftyFifty"
	end
	if m == 2 then
		return if r.switchStance then "fiftyFifty" else "switchFiftyFifty"
	end
	if j and j.entrySlide and k * (math.pi / 2) == j.entryAngle then
		return j.entrySlide
	end
	local chest = featureHeading + boardAngle + (Edge.toeSign(r) * math.pi) / 2
	return if DetMath.cos(chest - travelHeading) > 0 then "backboard" else "frontboard"
end

function FeatureRotation.stepFeatureRotation(s, j, heading, mem)
	local r, cfg = s.rider, s.cfg
	local R = cfg.featureRide.Rotation
	local stepRate = math.pi / 2 / cfg.feature.rotateTimePer90
	if j.boardAngle == j.targetAngle and mem.steerDir ~= 0 and mem.steerHeldTime >= cfg.feature.tapTime then
		local dir = mem.steerDir
		local side = Rotation.rotationSide(dir, heading + j.boardAngle, Edge.toeSign(r), r.ropeHeading)
		if j.rot.spinSide == nil then
			j.rot.spinSide = side
			j.rot.startDir = dir
		end
		j.rot.spinDir = dir
		local from = FeatureRotation.slideIdAt(j.boardAngle, heading, heading, r, j)
		local fromSide = if SlideController.isBoardslide(j.boardAngle) then FeatureRotation.slideSide(from) else nil
		local hardWay = fromSide ~= nil and side ~= fromSide
		local last = if #j.rotations > 0 then j.rotations[#j.rotations] else nil
		if last and last.dir == dir and last.endTick >= s.tick - 1 then
			last.deg += 90
			last.hardWay = last.hardWay or hardWay
		else
			table.insert(j.rotations, { deg = 90, dir = dir, side = side, hardWay = hardWay, from = from, endTick = -1, atTime = j.time })
		end
		if hardWay and cfg.feature.balanceEnabled then
			j.balance += R.HardWayHit * (if j.balance >= 0 then 1 else -1)
		end
		j.entrySlide = nil
		j.targetAngle = j.boardAngle + (dir * math.pi) / 2
	end
	local was = j.boardAngle
	j.boardAngle = Scalar.approach(j.boardAngle, j.targetAngle, stepRate * DT)
	if was ~= j.boardAngle and j.boardAngle == j.targetAngle and #j.rotations > 0 then
		j.rotations[#j.rotations].endTick = s.tick
	end
	j.rot.spinAngle = j.boardAngle - j.entryAngle
	j.rot.maxSpin = math.max(j.rot.maxSpin, math.abs(j.rot.spinAngle))
	local handle, result = Handle.updateHandle(r.handle, j.rot, mem.passPressed, { rate = stepRate, inAir = false }, cfg, DT)
	r.handle = handle
	if result.passed then
		table.insert(s.events, { type = "handlePass", tick = s.tick })
	end
	return if result.dropped then "handleDropped" else nil
end

function FeatureRotation.midRotation(j)
	return j.boardAngle ~= j.targetAngle
end

return FeatureRotation
