-- ParkBuilder.buildPark under the mock: every feature of the wake park and the
-- beginner system passes the validator (with placement) and is placed;
-- building twice gives the same Park/Features. Prints PARK BUILD OK.
local ParkBuilder = require(__root.Park.ParkBuilder)
local FeatureModel = require(__root.Park.FeatureModel)
local FeatureValidator = require(__root.Park.FeatureValidator)
local Sim = require(__root.Sim)
local function check(cond, msg) if not cond then error("FAIL: " .. msg, 2) end end
for _, park in { Sim.ParkLayout.WAKE_PARK, Sim.ParkLayout.BEGINNER_PARK } do
	local r = ParkBuilder.buildPark(park, true)
	if #r.refused > 0 or VERBOSE then
		FeatureValidator.print(r.reports)
	end
	for _, x in r.refused do print("REFUSED", x.id, table.concat(x.failed, "; ")) end
	check(#r.refused == 0, park.name .. ": every feature placed")
	local n = #FeatureModel.featuresFolder():GetChildren()
	local r2 = ParkBuilder.buildPark(park, true)
	check(#FeatureModel.featuresFolder():GetChildren() == n and #r2.placed == #r.placed, park.name .. ": buildPark is idempotent")
	print(park.name, #r.placed, "placed")
end
-- Backup: the built park is cloned into ServerStorage/Backup_<date>, the original stays.
local before = #FeatureModel.featuresFolder():GetChildren()
local b = ParkBuilder.backup("2026-10-16")
check(b ~= nil and b.Name == "Backup_2026-10-16", "backup folder")
local copy = b:FindFirstChild("Park")
check(copy ~= nil and #copy:FindFirstChild("Features"):GetChildren() == before, "backup holds every feature")
check(#FeatureModel.featuresFolder():GetChildren() == before, "backup leaves the park in place")
check(ParkBuilder.backup("2026-10-16") == b and #b:GetChildren() == 1, "backing up twice the same day replaces the copy")
print("PARK BUILD OK")
