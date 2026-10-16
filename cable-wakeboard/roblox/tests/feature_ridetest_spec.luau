-- FeatureRideTest under the Roblox mock, with the Luau sim, on every
-- catalogue feature as placed on the catalogue test map (or DEFS if set).
-- Prints the pass / fail table and RIDE TEST OK / RIDE TEST FAILED.
local FeatureRideTest = require(__root.Park.FeatureRideTest)
local Sim = require(__root.Sim)
local which = PARK or "catalog"
local park = if which == "wake" then Sim.ParkLayout.WAKE_PARK elseif which == "beginner" then Sim.ParkLayout.BEGINNER_PARK else Sim.ParkLayout.CATALOG_TEST_PARK
local rows, ok = FeatureRideTest.runAll(park.features, false, park.cable)
print(if ok then "RIDE TEST OK" else "RIDE TEST FAILED")
