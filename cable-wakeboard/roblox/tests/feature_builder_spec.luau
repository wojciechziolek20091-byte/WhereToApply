-- FeatureBuilder under the Roblox mock: every catalogue feature builds, its
-- Ride/ parts lie on the sim's ride surface (Start / End attachments within
-- 1 cm of Sim/FeatureShapes), top sheets sit on the ride surface, and part
-- counts stay under the budget. Prints FEATURE BUILDER OK.
local FeatureBuilder = require(__root.Park.FeatureBuilder)
local FeatureConfig = require(__root.Park.FeatureConfig)
local FeatureModel = require(__root.Park.FeatureModel)
local Shapes = require(__root.Sim.FeatureShapes)
local S = FeatureConfig.StudsPerMetre

local function check(cond, msg)
	if not cond then error("FAIL: " .. msg, 2) end
end

-- World stud position -> feature-local metres (u, v, h).
local function toLocal(root, p)
	local o = root:PointToObjectSpace(p)
	return -o.Z / S, o.X / S, o.Y / S
end

local names = {}
for name in FeatureConfig.Catalog do table.insert(names, name) end
table.sort(names)
for _, name in names do
	for _, side in { 1, -1 } do
		local m = FeatureBuilder.build({ id = name, catalog = name, side = side, origin = Vector3.new(30, 0, -12), heading = 1.1 })
		local root = m.PrimaryPart.CFrame
		local shape = Shapes.buildShape(name, nil, side)
		local rides = m:FindFirstChild("Ride"):GetChildren()
		check(#rides > 0, name .. ": has ride parts")
		local count = FeatureModel.partCount(m)
		check(count <= FeatureConfig.Validator.MaxParts, name .. ": " .. count .. " parts")
		for _, part in rides do
			check(part:GetAttribute("SurfaceRole") ~= nil and part:GetAttribute("SegmentIndex") ~= nil, name .. ": ride attributes")
			for _, an in { "Start", "End" } do
				local a = part:FindFirstChild(an)
				check(a, name .. ": " .. part.Name .. " has " .. an)
				local world = part.CFrame:PointToWorldSpace(a.CFrame.p)
				local u, v, h = toLocal(root, world)
				local piece = shape.pieces[part:GetAttribute("PieceIndex")]
				local want
				if piece.cap then
					-- Pyramid: the frustum's height (min of the face along and across the axis).
					local hit = Shapes.shapeSurfaceAt(shape, math.clamp(u, shape.uMin, shape.uMax), math.clamp(v, shape.vMin, shape.vMax))
					want = if hit then hit.height else -1
				elseif piece.wall then
					local x = (v - piece.wall.base) * piece.wall.side
					want = Shapes.wallHeightAt(piece.wall, x).height
				else
					want = Shapes.pieceHeightAt(piece, u).height
				end
				check(math.abs(h - want) < 0.01, string.format("%s: %s %s at u=%.3f h=%.4f, sim %.4f", name, part.Name, an, u, h, want))
			end
		end
	end
end
print("FEATURE BUILDER OK")
