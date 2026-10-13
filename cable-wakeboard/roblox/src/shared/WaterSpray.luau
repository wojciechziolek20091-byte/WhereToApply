--!strict
--[[
	WaterSpray

	Pastel spray off the board's trailing edge. One ParticleEmitter per
	rider, on an Attachment at the tail. Drive it with setIntensity() from
	speed and edge load each frame.
]]

local WaterSpray = {}

local rgb = Color3.fromRGB

WaterSpray.Config = {
	-- Pastel colours, fading from white through pink to lavender.
	Colors = ColorSequence.new({
		ColorSequenceKeypoint.new(0, rgb(255, 250, 252)),
		ColorSequenceKeypoint.new(0.45, rgb(255, 196, 214)),
		ColorSequenceKeypoint.new(1, rgb(196, 176, 240)),
	}),
	-- Chunky droplets that grow and fade.
	Size = NumberSequence.new({
		NumberSequenceKeypoint.new(0, 0.25),
		NumberSequenceKeypoint.new(0.4, 0.55),
		NumberSequenceKeypoint.new(1, 0.1),
	}),
	Transparency = NumberSequence.new({
		NumberSequenceKeypoint.new(0, 0.15),
		NumberSequenceKeypoint.new(0.7, 0.45),
		NumberSequenceKeypoint.new(1, 1),
	}),
	Lifetime = NumberRange.new(0.35, 0.7),
	MaxRate = 140, -- particles per second at full intensity
	Speed = NumberRange.new(6, 11), -- launch speed in studs per second
	SpreadAngle = Vector2.new(18, 35), -- degrees
	Acceleration = Vector3.new(0, -28, 0), -- droplets fall back to the water
	LightEmission = 0.25, -- slight glow in the dusk light
	Drag = 2.5,
	-- Tail offset from the rider Root, in rider space (+X is the nose).
	TailOffset = Vector3.new(-2.2, 0.1, -0.2),
}

--- Attach a spray emitter to a rider built by RiderBuilder. Returns the emitter.
function WaterSpray.attach(rider: Model): ParticleEmitter
	local c = WaterSpray.Config
	local root = rider.PrimaryPart
	assert(root, "rider has no PrimaryPart")
	local att = Instance.new("Attachment")
	att.Name = "SprayAttachment"
	att.Position = c.TailOffset
	-- Emit up and back, out from the heel edge.
	att.Orientation = Vector3.new(0, 180, 60)
	att.Parent = root

	local e = Instance.new("ParticleEmitter")
	e.Name = "Spray"
	e.Color = c.Colors
	e.Size = c.Size
	e.Transparency = c.Transparency
	e.Lifetime = c.Lifetime
	e.Rate = c.MaxRate * 0.5
	e.Speed = c.Speed
	e.SpreadAngle = c.SpreadAngle
	e.Acceleration = c.Acceleration
	e.LightEmission = c.LightEmission
	e.Drag = c.Drag
	e.Shape = Enum.ParticleEmitterShape.Box
	e.EmissionDirection = Enum.NormalId.Top
	e.Parent = att
	return e
end

--- 0 = no spray (in the air), 1 = full spray (hard edge at speed).
function WaterSpray.setIntensity(e: ParticleEmitter, intensity: number)
	local i = math.clamp(intensity, 0, 1)
	e.Rate = WaterSpray.Config.MaxRate * i
	e.Enabled = i > 0.02
end

return WaterSpray
