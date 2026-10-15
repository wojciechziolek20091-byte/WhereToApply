-- Tension-based water tricks: raley, backroll, frontroll, S-bend.
-- Mirrors src/sim/waterTrick.ts.
local Config = require(script.Parent.Config)
local Edge = require(script.Parent.Edge)
local Pop = require(script.Parent.Pop)
local Scalar = require(script.Parent.Scalar)
local Vec = require(script.Parent.Vec)

local DT, GRAVITY = Config.DT, Config.GRAVITY
local TAU = Scalar.TAU
local WaterTrick = {}

function WaterTrick.isSideways(r, cfg)
	if Vec.horizontalLength(r.vel) < 0.5 then
		return false
	end
	return math.abs(Scalar.wrapAngle(Vec.headingOf(r.vel) - r.ropeHeading)) > cfg.waterTrick.sidewaysAngle
end

function WaterTrick.canArm(r, cfg)
	return WaterTrick.isSideways(r, cfg)
		and r.tensionSmooth > cfg.waterTrick.tensionThreshold
		and Edge.edgeNorm(r, cfg.edge) > cfg.waterTrick.minEdge
		and r.handle == "inFront"
end

function WaterTrick.shouldDisarm(r, cfg)
	return r.tensionSmooth < cfg.waterTrick.tensionThreshold - cfg.waterTrick.hysteresis
end

function WaterTrick.airtimeFor(h)
	return 2 * math.sqrt((2 * math.max(0, h)) / GRAVITY)
end

function WaterTrick.planWaterTrick(tension, timing, input, cfg)
	local height = Pop.waterTrickHeight(tension, timing, cfg)
	local vy = math.sqrt(2 * GRAVITY * height)
	local airtime = WaterTrick.airtimeFor(height)
	local kind = if input.back then "backroll" elseif input.forward then "frontroll" else "raley"
	local minRoll = cfg.waterTrick.minRollHeight
	local rollTime = if height >= minRoll then airtime * 0.85 else WaterTrick.airtimeFor(minRoll) * 1.15
	return vy, {
		kind = kind,
		sBend = 0,
		airtime = airtime,
		u = 0,
		extension = 0,
		rollAngle = 0,
		rollRate = if kind == "raley" then 0 else TAU / rollTime,
		timing = timing,
		height = height,
		sBendKeyHeld = false,
	}
end

function WaterTrick.raleyExtension(u, cfg)
	local wt = cfg.waterTrick
	if u < wt.popPhaseEnd then
		return (u / wt.popPhaseEnd) * (math.pi / 2)
	end
	if u < wt.extensionEnd then
		return math.pi / 2
	end
	if u < wt.swingDownEnd then
		return (math.pi / 2) * (1 - (u - wt.extensionEnd) / (wt.swingDownEnd - wt.extensionEnd))
	end
	return 0
end

function WaterTrick.isInRaleyPosition(t, cfg)
	return t.kind == "raley" and t.u >= cfg.waterTrick.popPhaseEnd and t.u < cfg.waterTrick.extensionEnd
end

-- One tick of a water trick. Returns the spin input left for the rotation tracker.
function WaterTrick.stepWaterTrick(t, input, mem, cfg)
	local wt = cfg.waterTrick
	local dt = DT
	if t.sBendKeyHeld and mem.steerDir ~= t.sBend then
		t.sBendKeyHeld = false
	end
	local pressedNow = mem.steerDir ~= 0 and mem.steerHeldTime == 0
	if
		t.sBend == 0
		and pressedNow
		and WaterTrick.isInRaleyPosition(t, cfg)
		and t.u >= cfg.sBend.windowStart
		and t.u <= cfg.sBend.windowEnd
	then
		t.sBend = mem.steerDir
		t.sBendKeyHeld = true
		t.rollRate = TAU / math.max(0.2, (1 - t.u) * t.airtime * 0.85)
	end
	local spin = if t.sBendKeyHeld then 0 else mem.steerDir
	local held = spin ~= 0 or input.grab or t.sBend ~= 0
	local swinging = t.u >= wt.extensionEnd and t.u < wt.swingDownEnd
	local rate = if swinging and held then wt.heldSwingFactor else 1
	t.u = math.min(1, t.u + (dt / math.max(t.airtime, 0.1)) * rate)
	t.extension = if t.kind == "raley" then WaterTrick.raleyExtension(t.u, cfg) else 0
	if t.rollRate > 0 and t.rollAngle < TAU then
		t.rollAngle = math.min(TAU, t.rollAngle + t.rollRate * dt)
	end
	return spin
end

return WaterTrick
