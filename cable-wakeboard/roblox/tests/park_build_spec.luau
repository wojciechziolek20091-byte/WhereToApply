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
print("PARK BUILD OK")
