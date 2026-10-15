-- Trick catalogue. Data only: TricksClassify reads these tables. Mirrors
-- src/sim/tricks/data.ts row for row (array order matters for lookups).
local TricksData = {}

TricksData.GRABS = {
	indy = { id = "indy", name = "Indy", difficulty = 0.3 },
	melon = { id = "melon", name = "Melon", difficulty = 0.3 },
	mute = { id = "mute", name = "Mute", difficulty = 0.35 },
	stalefish = { id = "stalefish", name = "Stalefish", difficulty = 0.4 },
	nose = { id = "nose", name = "Nose", difficulty = 0.35 },
	tail = { id = "tail", name = "Tail", difficulty = 0.3 },
}

local function jumpName(approach, what)
	local side = if approach == "heelside" then "Backside" elseif approach == "toeside" then "Frontside" else "Straight"
	return side .. " " .. what
end

local SOURCES = {
	{ source = "kicker", what = "Kicker Air", difficulty = 0.5 },
	{ source = "flat", what = "Air Trick", difficulty = 0.8 },
	{ source = "slider", what = "Ollie Off", difficulty = 0.4 },
	{ source = "lineLift", what = "Line Lift", difficulty = 0.3 },
}
local APPROACHES = { "heelside", "toeside", "neutral" }

-- Straight jumps. Backside = heelside approach, frontside = toeside approach.
local JUMPS = {}
for _, src in SOURCES do
	for _, approach in APPROACHES do
		table.insert(JUMPS, {
			id = src.source .. "-" .. approach,
			source = src.source,
			approach = approach,
			name = jumpName(approach, src.what),
			-- A toeside approach is harder to load than heelside.
			difficulty = src.difficulty + (if approach == "toeside" then 0.2 elseif approach == "heelside" then 0.1 else 0),
		})
	end
end
TricksData.JUMPS = JUMPS

-- Rotation count is the main difficulty driver for spins.
TricksData.SPINS = {
	{ degrees = 180, difficulty = 1.0 },
	{ degrees = 360, difficulty = 2.0 },
	{ degrees = 540, difficulty = 3.2 },
	{ degrees = 720, difficulty = 4.5 },
	{ degrees = 900, difficulty = 6.0 },
}

-- Inverts: the head becomes the lowest point. The six basics.
TricksData.INVERTS = {
	{ id = "tantrum", name = "Tantrum", approach = "heelside", direction = "back", axis = "flip", difficulty = 3.0 },
	{ id = "hs-backroll", name = "Heelside Backroll", approach = "heelside", direction = "back", axis = "roll", difficulty = 3.0 },
	{ id = "hs-frontflip", name = "Heelside Frontflip", approach = "heelside", direction = "front", axis = "flip", difficulty = 4.0 },
	{ id = "ts-backroll", name = "Toeside Backroll", approach = "toeside", direction = "back", axis = "roll", difficulty = 3.5 },
	{ id = "ts-frontflip", name = "Toeside Frontflip", approach = "toeside", direction = "front", axis = "flip", difficulty = 4.2 },
	{ id = "frontroll", name = "Frontroll", approach = "toeside", direction = "front", axis = "roll", difficulty = 3.5 },
}

-- Raleys: body swings up above the board on rope tension.
TricksData.RALEYS = {
	{ id = "raley", name = "Raley", approach = "heelside", difficulty = 3.0 },
	{ id = "ts-raley", name = "Toeside Raley", approach = "toeside", difficulty = 3.5 },
}

-- Named combinations of a base trick and a spin.
TricksData.COMBOS = {
	{ id = "scarecrow", name = "Scarecrow", base = "frontroll", spinDegrees = 180, spinDirection = "frontside", difficulty = 5.0 },
	{ id = "tantrum-to-blind", name = "Tantrum to Blind", base = "tantrum", spinDegrees = 180, spinDirection = "backside", difficulty = 4.6 },
}

-- Jib tricks on boxes and rails.
TricksData.JIBS = {
	fiftyFifty = { id = "50-50", name = "50-50", difficulty = 0.6 },
	boardslide = { id = "boardslide", name = "Boardslide", difficulty = 1.0 },
}

-- Multipliers applied on top of base difficulty.
TricksData.MODIFIERS = {
	switch = 0.15,
	blind = 0.1,
	combo = 0.2,
}

return TricksData
