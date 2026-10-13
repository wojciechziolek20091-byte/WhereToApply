-- Smoke test for RiderBuilder under the mock. Run from roblox/:
--   luau tests/rider_spec.luau
require("./mock_roblox")
local RiderBuilder = require("../src/shared/RiderBuilder")

local failures = 0
local function check(cond, msg)
	if not cond then
		failures += 1
		print("FAIL: " .. msg)
	end
end

local ALLOWED = { Part = true, WedgePart = true, CornerWedgePart = true }
local FORBIDDEN = { Decal = true, Texture = true, SurfaceAppearance = true, MeshPart = true, SpecialMesh = true }

for _, name in RiderBuilder.paletteNames() do
	local model = RiderBuilder.build({ palette = name })
	local parts, minY, maxY = 0, math.huge, -math.huge
	local minX, maxX = math.huge, -math.huge
	local colors = {}
	for _, d in model:GetDescendants() do
		local cls = d.ClassName
		check(not FORBIDDEN[cls], `{name}: forbidden {cls}`)
		if d:IsA("BasePart") and d.Name ~= "Root" then
			parts += 1
			check(ALLOWED[cls], `{name}: unexpected class {cls}`)
			check(d.Material == Enum.Material.SmoothPlastic, `{name}: {d.Name} not SmoothPlastic`)
			check(d.Size.X > 0 and d.Size.Y > 0 and d.Size.Z > 0, `{name}: {d.Name} has a non-positive size`)
			local welded = false
			for _, c in d:GetChildren() do
				if c.ClassName == "WeldConstraint" and c.Part1 == d then welded = true end
			end
			check(welded, `{name}: {d.Name} not welded`)
			local p = d.CFrame.Position
			minY, maxY = math.min(minY, p.Y), math.max(maxY, p.Y)
			minX, maxX = math.min(minX, p.X), math.max(maxX, p.X)
			colors[string.format("%.3f,%.3f,%.3f", d.Color.R, d.Color.G, d.Color.B)] = true
		end
	end
	local distinct = 0
	for _ in colors do distinct += 1 end
	print(string.format("%-6s parts=%d  y=[%.2f, %.2f]  x=[%.2f, %.2f]  distinct colours=%d", name, parts, minY, maxY, minX, maxX, distinct))
	check(parts > 60 and parts < 260, `{name}: part count {parts} out of range`)
	check(minY > -0.4, `{name}: something hangs below the board ({minY})`)
	check(maxY > 4.6 and maxY < 6.5, `{name}: rider height {maxY} out of range`)
	check(distinct > 25, `{name}: too few shades ({distinct}) for faceted lighting`)
	check(model.PrimaryPart and model.PrimaryPart.Name == "Root", `{name}: PrimaryPart missing`)
	local att
	for _, d in model:GetDescendants() do if d.Name == "RopeAttachment" then att = d end end
	check(att ~= nil, `{name}: no RopeAttachment`)
end

-- Same seed, same rider; different seed, different facets.
local function signature(seed)
	local m = RiderBuilder.build({ palette = "A", seed = seed })
	local s = {}
	for _, d in m:GetDescendants() do
		if d:IsA("BasePart") then table.insert(s, string.format("%.4f", d.CFrame.Position.X + d.Size.Y)) end
	end
	return table.concat(s, ",")
end
check(signature(1) == signature(1), "same seed should give the same rider")
check(signature(1) ~= signature(2), "different seeds should give different facets")

-- Toggles and overrides.
local bare = RiderBuilder.build({ palette = "A", accessories = { Helmet = false, Handle = false } })
for _, d in bare:GetDescendants() do
	check(not string.find(d.Name, "^Helmet"), "helmet should be off")
	check(d.Name ~= "Bar", "handle should be off")
end
local pony = 0
for _, d in RiderBuilder.build({ palette = "B" }):GetDescendants() do
	if string.find(d.Name, "^Ponytail") then pony += 1 end
end
check(pony >= 2 and pony <= 3, `palette B should have a 2-3 wedge ponytail, got {pony}`)
check(not pcall(RiderBuilder.build, { palette = "Nope" }), "unknown palette should error")

if failures == 0 then print("ALL CHECKS PASSED") else print(`{failures} FAILURES`) os.exit(1) end
