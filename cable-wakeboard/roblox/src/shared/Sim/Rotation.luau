-- Rotation tracker: spin (A/D) around world up, flip (W/S) around the board's
-- long axis, with carry to the next half / whole turn. Mirrors src/sim/rotation.ts.
local Scalar = require(script.Parent.Scalar)

local Rotation = {}

function Rotation.createRotation(passWindow)
	return {
		spinAngle = 0,
		spinRate = 0,
		spinTarget = nil,
		spinDir = 0,
		startDir = 0,
		progressOffset = 0,
		spinSide = nil,
		maxSpin = 0,
		flipAngle = 0,
		flipRate = 0,
		flipTarget = nil,
		passWindow = passWindow,
		zonesResolved = 0,
		passes = 0,
		passTimer = 0,
		stoppedByRope = false,
		blindDir = 0,
	}
end

function Rotation.chestHeading(boardYaw, toes)
	return boardYaw + (toes * math.pi) / 2
end

-- Frontside when the chest turns toward the pull first, backside when the back does.
function Rotation.rotationSide(dir, boardYaw, toes, ropeHeading)
	local toRope = Scalar.wrapAngle(ropeHeading - Rotation.chestHeading(boardYaw, toes))
	local toward = if toRope >= 0 then 1 else -1
	return if toward == dir then "frontside" else "backside"
end

function Rotation.carryTarget(angle, rate, step, maxCarry)
	local d = Scalar.sign(rate)
	if d == 0 then
		return angle
	end
	local nextAngle = if d > 0 then math.ceil(angle / step) * step else math.floor(angle / step) * step
	return if math.abs(nextAngle - angle) <= maxCarry then nextAngle else angle
end

local function carry(angle, target, rate, dt)
	local nextAngle = Scalar.approach(angle, target, rate * dt)
	return nextAngle, nextAngle == target
end

function Rotation.stepSpin(rot, want, side, cfg, dt, rate)
	local accel = rate / cfg.spin.accelTime
	local blocked = rot.stoppedByRope and want == rot.spinDir
	if want ~= 0 and not blocked then
		if rot.spinSide == nil then
			rot.spinSide = side()
			rot.startDir = want
		end
		if want ~= rot.spinDir then
			rot.spinDir = want
		end
		rot.spinTarget = nil
		rot.stoppedByRope = false
		rot.spinRate = Scalar.approach(rot.spinRate, want * rate, accel * dt)
		rot.spinAngle += rot.spinRate * dt
	elseif rot.spinTarget == nil and rot.spinRate ~= 0 then
		rot.spinTarget = Rotation.carryTarget(rot.spinAngle, rot.spinRate, math.pi, cfg.spin.maxCarry)
	end
	if rot.spinTarget ~= nil then
		local angle, done = carry(rot.spinAngle, rot.spinTarget, rate, dt)
		rot.spinAngle = angle
		rot.spinRate = if done then 0 else Scalar.sign(rot.spinTarget - rot.spinAngle) * rate
		if done then
			rot.spinTarget = nil
		end
	end
	rot.maxSpin = math.max(rot.maxSpin, math.abs(rot.spinAngle))
end

function Rotation.stepFlip(rot, want, cfg, dt, rateScale)
	local rate = cfg.flip.rate * rateScale
	if want ~= 0 then
		rot.flipTarget = nil
		rot.flipRate = want * rate
		rot.flipAngle += rot.flipRate * dt
	elseif rot.flipTarget == nil and rot.flipRate ~= 0 then
		rot.flipTarget = Rotation.carryTarget(rot.flipAngle, rot.flipRate, Scalar.TAU, cfg.flip.maxCarry)
	end
	if rot.flipTarget ~= nil then
		local angle, done = carry(rot.flipAngle, rot.flipTarget, rate, dt)
		rot.flipAngle = angle
		rot.flipRate = if done then 0 else Scalar.sign(rot.flipTarget - rot.flipAngle) * rate
		if done then
			rot.flipTarget = nil
		end
	end
end

function Rotation.ropeRelativeYaw(boardYaw, toes, ropeHeading)
	return Scalar.wrapAngle(Rotation.chestHeading(boardYaw, toes) - ropeHeading)
end

return Rotation
