--!strict
-- Effects and audio hooks for the features (spec section 8), client side.
-- Every feature's FX/ folder has attachments (FeatureBuilder) tagged with an
-- FxKind: Splash, Droplets (HDPE slides), Sparks (steel pipes), LipSpray,
-- WallSlap. FeatureFX puts a ParticleEmitter on each (off until an event)
-- and Sounds keyed by SurfaceMaterial (FeatureConfig.Sounds; empty ids stay
-- silent), and turns the sim's events into effects:
--   featureEnter   splash at the entry, roll-up / slide sound
--   onFeature      slide particles while sliding (FeatureFX.step)
--   featureExit    splash at the exit
--   crash          impact sound and a camera shake (FeatureFX.onShake)
local FeatureConfig = require(script.Parent.FeatureConfig)
local FeatureRegistry = require(script.Parent.FeatureRegistry)

local FeatureFX = {}

-- Per kind: particle colour, rate while on, burst size on an event.
FeatureFX.KINDS = {
	Splash = { color = Color3.fromRGB(240, 248, 255), burst = 40, rate = 0 },
	Droplets = { color = Color3.fromRGB(210, 235, 250), burst = 0, rate = 30 },
	Sparks = { color = Color3.fromRGB(255, 200, 90), burst = 0, rate = 12 },
	LipSpray = { color = Color3.fromRGB(240, 248, 255), burst = 25, rate = 0 },
	WallSlap = { color = Color3.fromRGB(240, 248, 255), burst = 30, rate = 0 },
}

-- Camera shake hook: set by the client (strength 0..1).
FeatureFX.onShake = function(_strength: number) end

-- What fired, for tests and debugging: { kind, feature id, event }.
FeatureFX.log = {} :: { { kind: string, id: string, event: string } }

local prepared: { [Model]: boolean } = {}

local function emitterOf(a: Attachment): ParticleEmitter?
	return a:FindFirstChildOfClass("ParticleEmitter") :: ParticleEmitter?
end

local function soundId(material: string, name: string): string
	local s = (FeatureConfig.Sounds :: any)[material]
	if type(s) == "table" and s[name] then
		return s[name]
	end
	local top = (FeatureConfig.Sounds :: any)[name]
	return if type(top) == "string" then top else ""
end

-- Add emitters and sounds to a feature's FX attachments.
function FeatureFX.prepare(model: Model)
	if prepared[model] then
		return
	end
	prepared[model] = true
	local fx = model:FindFirstChild("FX")
	if not fx then
		return
	end
	local material = (model:GetAttribute("SurfaceMaterial") :: string?) or "HDPE"
	for _, a in fx:GetDescendants() do
		if a:IsA("Attachment") then
			local kind = (a:GetAttribute("FxKind") :: string?) or "Splash"
			local k = (FeatureFX.KINDS :: any)[kind]
			local e = Instance.new("ParticleEmitter")
			e.Name = kind
			e.Enabled = false
			e.Rate = k.rate
			e.Color = ColorSequence.new(k.color)
			e.Lifetime = NumberRange.new(0.3, 0.8)
			e.Speed = NumberRange.new(3, 7)
			e.SpreadAngle = Vector2.new(40, 40)
			e.Parent = a
			local soundName = if kind == "Splash" then "Splash" elseif kind == "WallSlap" then "WallSlap" elseif kind == "LipSpray" then "KickerRoll" else "Slide"
			local id = soundId(material, soundName)
			local snd = Instance.new("Sound")
			snd.Name = soundName
			snd.SoundId = id
			snd.Volume = if id == "" then 0 else 0.6
			snd.Looped = soundName == "Slide"
			snd.Parent = a
		end
	end
end

function FeatureFX.prepareAll()
	for _, m in FeatureRegistry.all() do
		FeatureFX.prepare(m)
	end
end

local function fire(model: Model, kinds: { [string]: boolean }, event: string, on: boolean?)
	local fx = model:FindFirstChild("FX")
	if not fx then
		return
	end
	FeatureFX.prepare(model)
	for _, a in fx:GetDescendants() do
		if a:IsA("Attachment") then
			local kind = (a:GetAttribute("FxKind") :: string?) or ""
			if kinds[kind] and (event ~= "featureEnter" or a.Name ~= "SplashExit") and (event ~= "featureExit" or a.Name ~= "SplashEntry") then
				local e = emitterOf(a)
				local k = (FeatureFX.KINDS :: any)[kind]
				if e then
					if on == nil then
						if k.burst > 0 then
							e:Emit(k.burst)
						end
					else
						e.Enabled = on
					end
				end
				local snd = a:FindFirstChildOfClass("Sound") :: Sound?
				if snd and snd.Volume > 0 then
					if on == false then
						snd:Stop()
					else
						snd:Play()
					end
				end
				table.insert(FeatureFX.log, { kind = kind, id = model.Name, event = event })
			end
		end
	end
end

-- Turn one tick's sim events into effects. `sim` is the client's sim state.
function FeatureFX.onEvents(sim: any, events: { any })
	for _, e in events do
		if e.type == "featureEnter" then
			local m = FeatureRegistry.byId(e.featureId)
			if m then
				fire(m, { Splash = true, LipSpray = false, WallSlap = true }, "featureEnter")
			end
		elseif e.type == "featureExit" then
			local m = FeatureRegistry.byId(e.featureId)
			if m then
				fire(m, { Droplets = true, Sparks = true }, "slideEnd", false)
				fire(m, { Splash = true, LipSpray = true }, "featureExit")
			end
		elseif e.type == "transition" and e.to == "onFeature" and sim.rider.ramp then
			local m = FeatureRegistry.byId(sim.rider.ramp.featureId)
			if m then
				fire(m, { Droplets = true, Sparks = true }, "slideStart", true)
			end
		elseif e.type == "crash" then
			local hit = sim.rider.ramp and FeatureRegistry.byId(sim.rider.ramp.featureId)
			FeatureFX.onShake(if hit then 1 else 0.5)
			table.insert(FeatureFX.log, { kind = "Impact", id = if hit then (hit :: Model).Name else "", event = e.reason })
		end
	end
end

return FeatureFX
