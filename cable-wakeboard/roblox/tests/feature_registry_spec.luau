-- FeatureRegistry under the Roblox mock: built features are indexed;
-- getSurfaceAt over every ride piece finds the right role and the sim's
-- height (within 2 cm); gaps have no surface but a crash volume; under a box
-- top is a shortOllie volume; getNearby finds what is close. FEATURE REGISTRY OK.
local FeatureBuilder = require(__root.Park.FeatureBuilder)
local FeatureConfig = require(__root.Park.FeatureConfig)
local FeatureModel = require(__root.Park.FeatureModel)
local FeatureRegistry = require(__root.Park.FeatureRegistry)
local Shapes = require(__root.Sim.FeatureShapes)
local S = FeatureConfig.StudsPerMetre
local DOWN = Vector3.new(0, -1, 0)

local function check(cond, msg)
	if not cond then error("FAIL: " .. msg, 2) end
end

local names = {}
for name in FeatureConfig.Catalog do table.insert(names, name) end
table.sort(names)
local folder = FeatureModel.featuresFolder()
local built = {}
for i, name in names do
	local origin = Vector3.new(i * 40, 0, (i % 3) * 25)
	local heading = (i * 0.7) % 6.28
	local m = FeatureBuilder.build({ id = "R_" .. name, catalog = name, origin = origin, heading = heading })
	m.Parent = folder
	built[name] = { model = m, shape = Shapes.buildShape(name, nil, 1) }
end
FeatureRegistry.init()
check(#FeatureRegistry.all() == #names, "all features indexed")

local hits, samples = 0, 0
for _, name in names do
	local b = built[name]
	local root = b.model.PrimaryPart.CFrame
	check(FeatureRegistry.byId("R_" .. name) == b.model, name .. ": byId")
	local near = FeatureRegistry.getNearby(root.Position, 5)
	check(near[1] == b.model, name .. ": nearest feature to its own root")
	for _, piece in b.shape.pieces do
		if piece.axis == "u" and not piece.cap then
			for k = 1, 9 do
				local u = piece.u0 + (piece.u1 - piece.u0) * k / 10
				local v = Shapes.pieceCentre(piece, u)
				local h = Shapes.pieceHeightAt(piece, u).height
				if h > 0.02 then
					samples += 1
					local pos = root:PointToWorldSpace(FeatureModel.offset(u, v, h + 0.5))
					local hit = FeatureRegistry.getSurfaceAt(pos, DOWN)
					check(hit ~= nil, string.format("%s: surface at u=%.2f (%s)", name, u, piece.role))
					local o = root:PointToObjectSpace(hit.point)
					local role = hit.role
					local want = piece.role
					check(role == want or (want == "Ramp" and role == "Lip"), string.format("%s: role %s, sim %s at u=%.2f", name, role, want, u))
					check(math.abs(o.Y / S - h) < 0.02, string.format("%s: height %.3f, sim %.3f at u=%.2f", name, o.Y / S, h, u))
					check(hit.progress >= 0 and hit.progress <= 1, name .. ": progress in 0..1")
					if piece.profile == "Round" then
						check(hit.profile == "Round" and hit.normal.Y > 0.9, name .. ": pipe normal from the axis")
					end
					hits += 1
					-- Just under a slide top is a short ollie.
					if piece.slide and h > 0.3 then
						local _, reason = FeatureRegistry.getCrashAt(root:PointToWorldSpace(FeatureModel.offset(u, v, h - 0.15)))
						check(reason == "shortOllie", string.format("%s: under the top at u=%.2f is %s", name, u, tostring(reason)))
					end
				end
			end
		elseif piece.wall then
			local w = piece.wall
			local x = (w.d0 + w.d1) / 2
			local prof = Shapes.wallHeightAt(w, x)
			if prof.height > 0.05 then
				samples += 1
				local u = (piece.u0 + piece.u1) / 2
				local v = w.base + w.side * x
				local n = Vector3.new(-w.side * prof.slope, 1, 0).Unit
				local nl = Vector3.new(n.X, n.Y, 0) -- (v, h) in Root-local studs is (X, Y)
				local surf = root:PointToWorldSpace(FeatureModel.offset(u, v, prof.height))
				local nWorld = root:VectorToWorldSpace(nl)
				local hit = FeatureRegistry.getSurfaceAt(surf + nWorld * 0.3 * S, -nWorld)
				check(hit ~= nil and hit.role == piece.role, string.format("%s: %s found along its normal", name, piece.role))
				hits += 1
			end
		end
	end
end
-- Gaps: no surface, a crash volume.
local gap = built.GapBox
local gp = gap.shape.pieces
local gu = (gp[1].u1 + gp[2].u0) / 2
local groot = gap.model.PrimaryPart.CFrame
check(FeatureRegistry.getSurfaceAt(groot:PointToWorldSpace(FeatureModel.offset(gu, 0, 1.5)), DOWN) == nil, "no surface over the gap")
local _, gr = FeatureRegistry.getCrashAt(groot:PointToWorldSpace(FeatureModel.offset(gu, 0, 0.3)))
check(gr == "missedSafetyPop", "the gap is a missedSafetyPop volume, got " .. tostring(gr))
-- Wall top edge.
local wall = built.WallRide
local wp = wall.shape.pieces[2].wall
local wr = wall.model.PrimaryPart.CFrame
local _, wtr = FeatureRegistry.getCrashAt(wr:PointToWorldSpace(FeatureModel.offset(2, wp.base + wp.side * wp.d1, wp.top + 0.1)))
check(wtr == "fellOffFeature", "over the wall's top edge, got " .. tostring(wtr))
print(string.format("FEATURE REGISTRY OK %d/%d", hits, samples))
