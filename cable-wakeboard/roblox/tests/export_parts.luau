-- Exports every part RiderBuilder makes, per palette, as compact JSON for the
-- web game (src/art/riderParts.json). Bundled with mock_roblox.luau and the
-- builder by scripts/export-rider-art.sh. Each part is
-- [shape, sx,sy,sz, px,py,pz, rx,ry,rz, ux,uy,uz, bx,by,bz, r,g,b]
-- where r/u/b are the CFrame's right/up/back columns (Roblox convention).
local SHAPES = { Block = 0, WedgePart = 1, CornerWedgePart = 2, Ball = 3, Cylinder = 4 }
local function n(x) return string.format("%.4f", x) end
local out = {}
for _, name in RiderBuilder.paletteNames() do
	local model = RiderBuilder.build({ palette = name, seed = 11 })
	local rows = {}
	for _, d in model:GetDescendants() do
		if d:IsA("BasePart") and d.Name ~= "Root" then
			local shape = if d.ClassName == "Part" then SHAPES[d.Shape.Name] else SHAPES[d.ClassName]
			local c = d.CFrame
			table.insert(rows, "[" .. table.concat({
				tostring(shape), n(d.Size.X), n(d.Size.Y), n(d.Size.Z),
				n(c.p.X), n(c.p.Y), n(c.p.Z),
				n(c.r.X), n(c.r.Y), n(c.r.Z), n(c.u.X), n(c.u.Y), n(c.u.Z), n(c.b.X), n(c.b.Y), n(c.b.Z),
				n(d.Color.R), n(d.Color.G), n(d.Color.B),
			}, ",") .. "]")
		end
	end
	table.insert(out, `"{name}":[` .. table.concat(rows, ",") .. "]")
end
print("{" .. table.concat(out, ",") .. "}")
