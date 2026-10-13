--!strict
--[[
	DuskLighting

	Soft dusk look: purple-to-pink sky, warm sun low on the horizon, light
	haze. Built from Lighting properties and post effects only, no textures.
	The sky gradient comes from Atmosphere (Color near the horizon, Decay
	higher up) over a sky with no skybox clouds.

	Usage: require(DuskLighting).apply()
]]

local Lighting = game:GetService("Lighting")

local DuskLighting = {}

local rgb = Color3.fromRGB

-- All tunables in one table, each with what it does.
DuskLighting.Config = {
	ClockTime = 17.85, -- sun just above the horizon
	GeographicLatitude = 30, -- lower latitude keeps the sun's path long and low
	Brightness = 2.2, -- sun strength
	ExposureCompensation = 0.15, -- small lift so pastels do not go muddy
	Ambient = rgb(92, 70, 118), -- purple fill in shadow
	OutdoorAmbient = rgb(150, 112, 150), -- pink-violet sky fill
	ColorShift_Top = rgb(255, 196, 150), -- warm sunlit tops
	ColorShift_Bottom = rgb(120, 90, 160), -- cool purple bounce from below
	EnvironmentDiffuseScale = 0.6, -- soft sky light on flat-shaded facets
	EnvironmentSpecularScale = 0.15, -- almost no shine on SmoothPlastic

	Atmosphere = {
		Density = 0.34, -- light haze
		Offset = 0.12, -- haze starts a little away from the camera
		Color = rgb(255, 170, 178), -- pink near the horizon
		Decay = rgb(120, 92, 170), -- purple higher in the sky
		Glare = 0.45, -- warm glow around the sun
		Haze = 1.9, -- softens distant towers and shoreline
	},

	Sky = {
		SunAngularSize = 18, -- big soft sun disc
		MoonAngularSize = 6,
		StarCount = 400, -- a few early stars in the purple
	},

	Bloom = { Intensity = 0.6, Size = 30, Threshold = 1.6 },
	SunRays = { Intensity = 0.06, Spread = 0.8 },
	ColorCorrection = {
		Brightness = 0.02,
		Contrast = 0.06,
		Saturation = 0.12, -- push the palette saturation a little
		TintColor = rgb(255, 240, 236), -- faint warm tint
	},
}

local function replace(className: string, name: string): Instance
	local existing = Lighting:FindFirstChild(name)
	if existing then
		existing:Destroy()
	end
	local inst = Instance.new(className)
	inst.Name = name
	inst.Parent = Lighting
	return inst
end

--- Apply the dusk look to Lighting. Safe to call more than once.
function DuskLighting.apply()
	local c = DuskLighting.Config
	Lighting.ClockTime = c.ClockTime
	Lighting.GeographicLatitude = c.GeographicLatitude
	Lighting.Brightness = c.Brightness
	Lighting.ExposureCompensation = c.ExposureCompensation
	Lighting.Ambient = c.Ambient
	Lighting.OutdoorAmbient = c.OutdoorAmbient
	Lighting.ColorShift_Top = c.ColorShift_Top
	Lighting.ColorShift_Bottom = c.ColorShift_Bottom
	Lighting.EnvironmentDiffuseScale = c.EnvironmentDiffuseScale
	Lighting.EnvironmentSpecularScale = c.EnvironmentSpecularScale
	Lighting.GlobalShadows = true

	-- Remove any existing sky boxes and atmospheres so ours wins.
	for _, child in Lighting:GetChildren() do
		if child:IsA("Sky") or child:IsA("Atmosphere") then
			child:Destroy()
		end
	end

	local atmo = replace("Atmosphere", "DuskAtmosphere") :: Atmosphere
	atmo.Density = c.Atmosphere.Density
	atmo.Offset = c.Atmosphere.Offset
	atmo.Color = c.Atmosphere.Color
	atmo.Decay = c.Atmosphere.Decay
	atmo.Glare = c.Atmosphere.Glare
	atmo.Haze = c.Atmosphere.Haze

	local sky = replace("Sky", "DuskSky") :: Sky
	sky.SunAngularSize = c.Sky.SunAngularSize
	sky.MoonAngularSize = c.Sky.MoonAngularSize
	sky.StarCount = c.Sky.StarCount
	sky.CelestialBodiesShown = true

	local bloom = replace("BloomEffect", "DuskBloom") :: BloomEffect
	bloom.Intensity = c.Bloom.Intensity
	bloom.Size = c.Bloom.Size
	bloom.Threshold = c.Bloom.Threshold

	local rays = replace("SunRaysEffect", "DuskSunRays") :: SunRaysEffect
	rays.Intensity = c.SunRays.Intensity
	rays.Spread = c.SunRays.Spread

	local cc = replace("ColorCorrectionEffect", "DuskColor") :: ColorCorrectionEffect
	cc.Brightness = c.ColorCorrection.Brightness
	cc.Contrast = c.ColorCorrection.Contrast
	cc.Saturation = c.ColorCorrection.Saturation
	cc.TintColor = c.ColorCorrection.TintColor
end

return DuskLighting
