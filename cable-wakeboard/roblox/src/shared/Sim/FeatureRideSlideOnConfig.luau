-- Twin of src/sim/featureRide/slideOnConfig.ts (SlideOnConfig, side approaches
-- spec section 4): the slide-on numbers (generated into Config.luau as
-- DEFAULT_CONFIG.slideOn) and the reachable-height calculator.
--   SlideOnConfig.maxReachableHeight(cfg, charge, noseLift, type?, speed?, angle?, edgeLoad?)
--   SlideOnConfig.alignSlide(yaw, cfg) -> { boardAngle, hit }
local Config = require(script.Parent.Config)
local DetMath = require(script.Parent.DetMath)
local Scalar = require(script.Parent.Scalar)

local G = 9.81
local SlideOnConfig = {}

SlideOnConfig.DEFAULT = Config.DEFAULT_CONFIG.slideOn

-- Vertical speed of a side-entry pop with this charge and edge load (m/s, v2 spec 1.1).
function SlideOnConfig.sidePopSpeed(charge, cfg, edgeLoad)
	return Scalar.lerp(cfg.ollie.minV, cfg.ollie.maxV, Scalar.clamp01(charge)) * cfg.slideOn.SidePopScale
		+ cfg.slideOn.EdgePopBonus * (edgeLoad or 0)
end

function SlideOnConfig.noseClearance(sideType, cfg)
	return cfg.slideOn.NoseClearance + (if sideType == "Coping" then cfg.slideOn.CopingExtraClearance else 0)
end

function SlideOnConfig.maxReachableHeight(cfg, charge, noseLift, sideType, speed, angle, edgeLoad)
	local S = cfg.slideOn
	local t = sideType or "Rounded"
	local v = speed or S.CalcSpeed
	local a = angle or S.CalcAngle
	local load = edgeLoad or 0
	local vy = SlideOnConfig.sidePopSpeed(charge, cfg, load)
	local peak = (vy * vy) / (2 * G)
	if noseLift <= 0 then
		return peak - cfg.featureRide.Entry.Clearance
	end
	if t == "Rail" then
		return peak + S.RailCentreAllowance
	end
	local nose = peak + (S.BoardLength / 2) * DetMath.sin(noseLift) - SlideOnConfig.noseClearance(t, cfg)
	local vin = v * DetMath.sin(a) + S.EdgeReleaseBonus * load
	local budget = 0.5 * vin * vin * S.ClimbEfficiency - S.EdgeFriction[t]
	local climb = peak + budget / G + (if t == "Round" then S.RoundTailAllowance else 0)
	-- A bank never digs the nose in: only the climb counts.
	return if t == "Bank" then climb else math.min(nose, climb)
end

-- The slide a side approach lines up into from the board's angle to the
-- axis (v2 spec 2): a 50-50 up to AlignHit (a balance hit past AlignClean),
-- the nearest 90 between, a fakie 50-50 toward 180. Never a crash.
function SlideOnConfig.alignSlide(yaw, cfg)
	local S = cfg.slideOn
	local a = math.abs(yaw)
	if a <= S.AlignHit then
		return { boardAngle = 0, hit = if a > S.AlignClean then S.AlignHitAmount else 0 }
	end
	if a >= math.pi - S.AlignHit then
		return { boardAngle = math.pi, hit = if a < math.pi - S.AlignClean then S.AlignHitAmount else 0 }
	end
	return { boardAngle = if yaw >= 0 then math.pi / 2 else -math.pi / 2, hit = 0 }
end

return SlideOnConfig
