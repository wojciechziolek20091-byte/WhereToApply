-- Twin of src/sim/featureRide/pressController.ts (PressController, feature
-- riding spec 5.5): W / S held on a 50-50 rocks onto the nose / tail; the
-- fore-aft window narrows with time held; a W/S tap at the very end is a tap.
local Config = require(script.Parent.Config)
local Scalar = require(script.Parent.Scalar)
local SlideController = require(script.Parent.FeatureRideSlideController)

local DT = Config.DT
local PressController = {}

function PressController.stepPress(s, j, mem, remaining)
	local cfg = s.cfg
	local P = cfg.featureRide.Press
	local can = not SlideController.isBoardslide(j.boardAngle) and j.boardAngle == j.targetAngle
	local want = if can and mem.foreDir ~= 0 and mem.foreHeldTime >= cfg.feature.tapTime then mem.foreDir else 0
	if want ~= j.press then
		j.press = want
		j.pressTime = 0
	end
	if j.press ~= 0 then
		j.pressTime += DT
	end
	j.pressAmount = Scalar.approach(j.pressAmount, j.press, DT / P.RampTime)
	if j.pressAmount >= 0.5 then
		j.pressTimes.nose += DT
	elseif j.pressAmount <= -0.5 then
		j.pressTimes.tail += DT
	end
	if j.endTap == nil and remaining <= P.EndTapZone and mem.foreTap ~= 0 and not SlideController.isBoardslide(j.boardAngle) then
		j.endTap = if mem.foreTap > 0 then "nose" else "tail"
	end
end

function PressController.pressPitch(j, s)
	return j.pressAmount * s.cfg.featureRide.Press.Pitch
end

return PressController
