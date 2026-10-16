-- Trick registry: names and base points, as data. Mirrors src/sim/tricks/data.ts.
local TricksData = {}

TricksData.GRABS = {
	indy = { id = "indy", name = "Indy" },
	stalefish = { id = "stalefish", name = "Stalefish" },
	nose = { id = "nose", name = "Nose" },
	tail = { id = "tail", name = "Tail" },
}

TricksData.INVERTS = {
	raley = { id = "raley", name = "Raley", points = 300, invert = false },
	tantrum = { id = "tantrum", name = "Tantrum", points = 400, invert = true },
	frontFlip = { id = "frontFlip", name = "Front Flip", points = 400, invert = true },
	backroll = { id = "backroll", name = "Backroll", points = 450, invert = true },
	frontroll = { id = "frontroll", name = "Frontroll", points = 450, invert = true },
	sBend = { id = "sBend", name = "S-Bend", points = 600, invert = true },
}

TricksData.SLIDES = {
	fiftyFifty = { id = "fiftyFifty", name = "50-50", pointsPerSecond = 80 },
	switchFiftyFifty = { id = "switchFiftyFifty", name = "Switch 50-50", pointsPerSecond = 80 },
	backboard = { id = "backboard", name = "Backboard", pointsPerSecond = 120 },
	frontboard = { id = "frontboard", name = "Frontboard", pointsPerSecond = 120 },
	-- Riding up a wall ride's transition onto the wall (wake park features).
	wallRide = { id = "wallRide", name = "Wall Ride", pointsPerSecond = 150 },
}

TricksData.POINTS = {
	ollie = 50,
	spinPer180 = 150,
	backsideSpinFactor = 1.2,
	handlePass = 100,
	mobeBonus = 350,
	grabPerInterval = 60,
	grabInterval = 0.25,
	grabMaxIntervals = 4,
	toBlind = 150,
	blindOut = 200,
	popOn = 150,
}

return TricksData
