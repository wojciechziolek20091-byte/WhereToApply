-- VisualAudit under the mock: builds the wake park and the beginner system and
-- prints the visual-bug counts. Prints VISUAL AUDIT OK.
local ParkBuilder = require(__root.Park.ParkBuilder)
local FeatureModel = require(__root.Park.FeatureModel)
local VisualAudit = require(__root.Park.VisualAudit)
local Sim = require(__root.Sim)
for _, park in { Sim.ParkLayout.WAKE_PARK, Sim.ParkLayout.BEGINNER_PARK } do
	ParkBuilder.buildPark(park, true)
	print(park.name)
	local r = VisualAudit.scan(FeatureModel.featuresFolder())
	VisualAudit.print(r, LIMIT or 4)
	local line = {}
	for k, v in r.counts do table.insert(line, k .. "=" .. v) end
	table.sort(line)
	print("COUNTS", park.name, table.concat(line, " "))
	if PERFEATURE then
		local by = {}
		for _, f in r.findings do
			by[f.feature] = by[f.feature] or {}
			by[f.feature][f.check] = (by[f.feature][f.check] or 0) + 1
		end
		for id, c in by do
			local s = {}
			for k, v in c do table.insert(s, k .. "=" .. v) end
			table.sort(s)
			print("   ", id, table.concat(s, " "))
		end
	end
end
print("VISUAL AUDIT OK")
