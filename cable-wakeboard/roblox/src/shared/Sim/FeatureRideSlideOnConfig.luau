-- Twin of src/sim/featureRide/slideOnConfig.ts (SlideOnConfig, side approaches
-- spec section 4): the slide-on numbers (generated into Config.luau as
-- DEFAULT_CONFIG.slideOn) and the reachable-height calculator.
--   SlideOnConfig.maxReachableHeight(cfg, charge, noseLift, type?, speed?, angle?)
local Config = require(script.Parent.Config)
local DetMath = require(script.Parent.DetMath)
local Scalar = require(script.Parent.Scalar)

local G = 9.81
local SlideOnConfig = {}

SlideOnConfig.DEFAULT = Config.DEFAULT_CONFIG.slideOn

function SlideOnConfig.sidePopSpeed(charge, cfg)
	return Scalar.lerp(cfg.ollie.minV, cfg.ollie.maxV, Scalar.clamp01(charge)) * cfg.slideOn.SidePopScale
end

function SlideOnConfig.noseClearance(sideType, cfg)
	return cfg.slideOn.NoseClearance + (if sideType == "Coping" then cfg.slideOn.CopingExtraClearance else 0)
end

function SlideOnConfig.maxReachableHeight(cfg, charge, noseLift, sideType, speed, angle)
	local S = cfg.slideOn
	local t = sideType or "Rounded"
	local v = speed or S.CalcSpeed
	local a = angle or S.CalcAngle
	local vy = SlideOnConfig.sidePopSpeed(charge, cfg)
	local peak = (vy * vy) / (2 * G)
	if noseLift <= 0 then
		return peak - cfg.featureRide.Entry.Clearance
	end
	if t == "Rail" then
		return peak + S.RailCentreAllowance
	end
	local nose = peak + (S.BoardLength / 2) * DetMath.sin(noseLift) - SlideOnConfig.noseClearance(t, cfg)
	local vin = v * DetMath.sin(a)
	local budget = 0.5 * vin * vin * S.ClimbEfficiency - S.EdgeFriction[t]
	local climb = peak + budget / G + (if t == "Round" then S.RoundTailAllowance else 0)
	return math.min(nose, climb)
end

return SlideOnConfig
