-- How to orient the rider model. Twin of src/render/pose.ts.
--   yaw     travel heading + spin in the air / board angle on a feature / blind spin-out
--   invert  axis (board frame: x along the board, z toward the toes) and angle
--   lean    tilt about the board's long axis for the edge
--   raley   the raley's body extension (rad); the animator turns it into the swing
local Sim = require(script.Parent.Sim)

local RiderPose = {}

function RiderPose.of(r)
	local switchStance = if r.air then r.air.takeoffSwitch else r.switchStance
	local toes = Sim.Edge.toeSign({ stance = r.stance, switchStance = switchStance })
	local yaw = r.heading
	if r.air then
		yaw += r.air.rot.spinAngle
	end
	if r.jib then
		yaw += r.jib.boardAngle
	end
	if r.spinOut then
		yaw += r.spinOut.dir * math.pi * (r.spinOut.time / 0.4 - 1)
	end
	local invert = nil
	local raley = 0
	local air = r.air
	if air then
		local t = air.trick
		local h = math.sqrt(0.5)
		if t and t.sBend ~= 0 then
			invert = { axis = { h, 0, h }, angle = t.sBend * t.rollAngle }
			raley = t.extension
		elseif t and t.kind ~= "raley" then
			local sign = if t.kind == "backroll" then -toes else toes
			invert = { axis = { h, h, 0 }, angle = sign * t.rollAngle }
		elseif t then
			raley = t.extension
		elseif air.rot.flipAngle ~= 0 then
			invert = { axis = { 1, 0, 0 }, angle = toes * air.rot.flipAngle }
		elseif air.slideOn and air.slideOn.pitch > 0 then
			-- Slide-on: the leading end lifts. The nose (the end along the travel) about the
			-- board's z; the edge facing the feature about its long axis.
			local so = air.slideOn
			if so.lead == "nose" then
				invert = { axis = { 0, 0, 1 }, angle = (if math.cos(air.rot.spinAngle) >= 0 then 1 else -1) * so.pitch }
			else
				local side = -math.sin(yaw) * -math.sin(so.featureHeading) + math.cos(yaw) * math.cos(so.featureHeading)
				invert = { axis = { 1, 0, 0 }, angle = -(if side * so.toward >= 0 then 1 else -1) * so.pitch }
			end
		end
	end
	return {
		yaw = yaw,
		toes = toes,
		invert = invert,
		lean = -toes * r.edgeAngle,
		raley = raley,
		handleBehind = r.handle == "behind",
	}
end

return RiderPose
