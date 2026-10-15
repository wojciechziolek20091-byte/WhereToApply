-- Fixed-timestep accumulator: variable frame time in, whole 60 Hz ticks out.
-- Mirrors src/sim/stepper.ts. In Roblox, call advance() from RunService.Heartbeat.
local Config = require(script.Parent.Config)

local Stepper = {}

function Stepper.createStepper(maxTicksPerFrame, dt)
	return { accumulator = 0, maxTicksPerFrame = maxTicksPerFrame or 8, dt = dt or Config.DT }
end

function Stepper.advanceStepper(stepper, frameSeconds, tick)
	stepper.accumulator += math.max(0, frameSeconds)
	local ticks = 0
	while stepper.accumulator >= stepper.dt and ticks < stepper.maxTicksPerFrame do
		tick()
		stepper.accumulator -= stepper.dt
		ticks += 1
	end
	if ticks == stepper.maxTicksPerFrame and stepper.accumulator >= stepper.dt then
		-- Drop the backlog rather than trying to catch up forever.
		stepper.accumulator = 0
	end
	return ticks, stepper.accumulator / stepper.dt
end

return Stepper
