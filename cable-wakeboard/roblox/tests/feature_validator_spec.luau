-- FeatureValidator under the Roblox mock: every catalogue feature passes the
-- section 5 rules; broken parameters fail the right rule. Prints the report
-- and FEATURE VALIDATOR OK.
local FeatureBuilder = require(__root.Park.FeatureBuilder)
local FeatureConfig = require(__root.Park.FeatureConfig)
local FeatureValidator = require(__root.Park.FeatureValidator)

local function check(cond, msg)
	if not cond then error("FAIL: " .. msg, 2) end
end

local names = {}
for name in FeatureConfig.Catalog do table.insert(names, name) end
table.sort(names)
local reports = {}
for _, name in names do
	local m = FeatureBuilder.build({ id = name, catalog = name, origin = Vector3.new(0, 0, 0), heading = 0.3 })
	table.insert(reports, FeatureValidator.validate(m))
end
FeatureValidator.print(reports)
for _, r in reports do
	check(r.ok, r.id .. " fails the validator")
end

-- Broken parameters fail the right rule.
local function failsRule(catalog, params, rule)
	local m = FeatureBuilder.build({ id = "bad", catalog = catalog, params = params, origin = Vector3.new(0, 0, 0), heading = 0 })
	local r = FeatureValidator.validate(m)
	for _, c in r.checks do
		if c.rule == rule then
			return not c.pass, c.detail
		end
	end
	return false, "rule not checked"
end
local cases = {
	{ "Slider", { safetyAngle = 30 }, "Safety slope" },
	{ "MediumKicker", { width = 2 }, "Kicker width" },
	{ "PipeRail", { mains = { { height = 1.8, gapBefore = 0, kinks = { { length = 10, angle = 0 } } } } }, "Rail height from water" },
	{ "KinkRail", { mains = { { height = 1.0, gapBefore = 0, kinks = { { length = 5, angle = 0 }, { length = 5, angle = -25 } } } } }, "Kink angle" },
	{ "Slider", { width = 0.9 }, "Box top width" },
}
for _, c in cases do
	local failed, detail = failsRule(c[1], c[2], c[3])
	check(failed, `{c[1]} with bad params should fail "{c[3]}" ({detail})`)
end
print("FEATURE VALIDATOR OK")
