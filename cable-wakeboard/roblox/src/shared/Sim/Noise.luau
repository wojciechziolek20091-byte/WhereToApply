-- Deterministic smooth 1D value noise in [-1, 1]. Mirrors src/sim/math/noise.ts.
local Rng = require(script.Parent.Rng)

local Noise = {}

function Noise.hashUnit(n)
	return Rng.nextFloat(Rng.createRng(n))
end

function Noise.valueNoise(t, seed)
	local i = math.floor(t)
	local f = t - i
	local a = Noise.hashUnit(i + seed * 7919)
	local b = Noise.hashUnit(i + 1 + seed * 7919)
	local w = f * f * (3 - 2 * f)
	return (a + (b - a) * w) * 2 - 1
end

return Noise
