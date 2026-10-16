-- FeatureRideTest under the Roblox mock, with the Luau sim, on every
-- catalogue feature as placed on the catalogue test map (or DEFS if set).
-- Prints the pass / fail table and RIDE TEST OK / RIDE TEST FAILED.
local FeatureRideTest = require(__root.Park.FeatureRideTest)
local Sim = require(__root.Sim)
local defs = rawget(_G, "DEFS") or Sim.ParkLayout.CATALOG_TEST_PARK.features
local rows, ok = FeatureRideTest.runAll(defs)
print(if ok then "RIDE TEST OK" else "RIDE TEST FAILED")
