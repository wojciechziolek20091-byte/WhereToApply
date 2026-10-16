--!strict
-- FeatureStyle (layout spec section 4): the one place park parts get their
-- colour, material and reflectance. Roles and values are FeatureConfig.Style
-- (generated from src/park/featureConfig.ts, which the web renderer reads too).
--
--   FeatureStyle.apply(part, "Feature")      -- white HDPE
--   FeatureStyle.apply(part, "RailSupport")  -- black steel
--
-- Features: white. Rails and their supports and pontoons: black. Towers: grey
-- steel; chains and guy wires dark grey. Difficulty shows on the sign posts
-- only (FeatureStyle.difficulty). No tints, stripes, decals or logos.
local FeatureConfig = require(script.Parent.FeatureConfig)

local FeatureStyle = {}

export type Role = string

local function entry(role: Role): any
	local s = (FeatureConfig.Style :: any)[role]
	assert(s, "unknown FeatureStyle role " .. role)
	return s
end

function FeatureStyle.color(role: Role): Color3
	local c = entry(role).color
	return Color3.fromRGB(c[1], c[2], c[3])
end

function FeatureStyle.material(role: Role): Enum.Material
	return (Enum.Material :: any)[entry(role).material]
end

-- Paint a part in a role: colour, material, reflectance; records the role.
function FeatureStyle.apply(part: BasePart, role: Role): BasePart
	local s = entry(role)
	part.Color = Color3.fromRGB(s.color[1], s.color[2], s.color[3])
	part.Material = (Enum.Material :: any)[s.material]
	part.Reflectance = s.reflectance
	part:SetAttribute("StyleRole", role)
	return part
end

-- The sign band's difficulty colour (1-4), SmoothPlastic.
function FeatureStyle.difficulty(part: BasePart, difficulty: number): BasePart
	local c = FeatureConfig.Difficulty[difficulty].color
	part.Color = Color3.fromRGB(c[1], c[2], c[3])
	part.Material = Enum.Material.SmoothPlastic
	part.Reflectance = 0
	part:SetAttribute("StyleRole", "Difficulty")
	return part
end

-- Every (material, colour) pair a visible park part may have, as
-- VisualAudit's `allowed` set ("SmoothPlastic 240,240,240").
function FeatureStyle.allowed(): { [string]: boolean }
	local out = {}
	for _, s in FeatureConfig.Style :: any do
		out[`{s.material} {s.color[1]},{s.color[2]},{s.color[3]}`] = true
	end
	for _, d in FeatureConfig.Difficulty do
		out[`SmoothPlastic {d.color[1]},{d.color[2]},{d.color[3]}`] = true
	end
	return out
end

return FeatureStyle
