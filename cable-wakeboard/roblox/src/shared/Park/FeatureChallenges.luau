--!strict
-- Challenges (spec section 11): data entries per feature and a check against
-- the sim's events. Kinds:
--   slide     a slide (sim id) held for `time` s, or the whole main (`full`)
--   entry     a slide started with this entry (popOn, ollieOn...)
--   airtime   an air off the feature of at least `time` s, landed cleanly
--   wallRide  on the wall for `time` s
local FeatureChallenges = {}

export type Challenge = { id: string, feature: string, text: string, kind: string, slide: string?, entry: string?, time: number?, full: boolean? }

FeatureChallenges.LIST = {
	{ id = "C_PipeBackboard", feature = "S2_PipeRail", text = "Backboard the full pipe rail", kind = "slide", slide = "backboard", full = true },
	{ id = "C_MediumAir", feature = "S1_MediumKicker", text = "Air over 1.1 s off the medium kicker", kind = "airtime", time = 1.1 },
	{ id = "C_FunboxFull", feature = "S1_Funbox", text = "50-50 the funbox top to bottom", kind = "slide", slide = "fiftyFifty", full = true },
	{ id = "C_GapPopOn", feature = "S2_GapBox", text = "Pop-on the gap box", kind = "entry", entry = "popOn" },
	{ id = "C_KinkFrontboard", feature = "S2_FlatDownRail", text = "Frontboard the flat-down rail for 1 s", kind = "slide", slide = "frontboard", time = 1.0 },
	{ id = "C_Transfer", feature = "S3_Transfer", text = "Transfer from box A to box B", kind = "entry", entry = "transfer" },
	{ id = "C_ProAir", feature = "S3_ProKicker", text = "Air over 1.5 s off the pro kicker", kind = "airtime", time = 1.5 },
	{ id = "C_StepUp", feature = "S4_StepUp", text = "Pop up to the high rail of the step-up", kind = "entry", entry = "transfer" },
	{ id = "C_Rooftop", feature = "S3_Rooftop", text = "50-50 over the rooftop", kind = "slide", slide = "fiftyFifty", time = 1.0 },
	{ id = "C_Pyramid", feature = "S4_Pyramid", text = "Clear the pyramid: 1 s of air", kind = "airtime", time = 1.0 },
	{ id = "C_Wall", feature = "S5_WallRide", text = "Ride the wall for 0.4 s", kind = "wallRide", time = 0.4 },
	{ id = "C_Spine", feature = "S4_Spine", text = "Land the spine's down slope", kind = "airtime", time = 0.6 },
	{ id = "C_BeginnerSlide", feature = "B_Slider", text = "Slide the whole beginner slider", kind = "slide", slide = "fiftyFifty", full = true },
} :: { Challenge }

-- Challenges for one feature.
function FeatureChallenges.forFeature(featureId: string): { Challenge }
	local out = {}
	for _, c in FeatureChallenges.LIST do
		if c.feature == featureId then
			table.insert(out, c)
		end
	end
	return out
end

-- Does one sim event complete the challenge? `fullTime` is the time a slide
-- takes over the whole main at cable speed (from the feature's length).
function FeatureChallenges.check(c: Challenge, e: any, fullTime: number?): boolean
	if c.kind == "slide" or c.kind == "entry" or c.kind == "wallRide" then
		if e.type ~= "slideDone" or e.jib.featureId ~= c.feature then
			return false
		end
		local j = e.jib
		if c.kind == "entry" then
			return j.entry == c.entry
		elseif c.kind == "wallRide" then
			return (j.slideTimes.wallRide or 0) >= (c.time or 0)
		end
		local t = j.slideTimes[c.slide :: string] or 0
		local need = if c.full then (fullTime or 1) * 0.9 else (c.time or 0)
		return t >= need
	elseif c.kind == "airtime" then
		return e.type == "landed" and e.air.featureId == c.feature and e.air.time >= (c.time or 0) and e.landing.crash == nil
	end
	return false
end

-- All challenges completed by a list of events.
function FeatureChallenges.completed(events: { any }, fullTimes: { [string]: number }?): { string }
	local out = {}
	for _, c in FeatureChallenges.LIST do
		for _, e in events do
			if FeatureChallenges.check(c, e, if fullTimes then fullTimes[c.feature] else nil) then
				table.insert(out, c.id)
				break
			end
		end
	end
	return out
end

return FeatureChallenges
