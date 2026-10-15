-- Seeded PRNG (mulberry32). Mirrors src/sim/math/rng.ts bit for bit using
-- 32-bit integer arithmetic. The state is a plain table so it serialises.
local Rng = {}

local TWO32 = 4294967296

-- Low 32 bits of a * b for unsigned 32-bit a, b (Math.imul without overflow).
local function imul(a, b)
	local ah, al = bit32.rshift(a, 16), bit32.band(a, 0xffff)
	local bh, bl = bit32.rshift(b, 16), bit32.band(b, 0xffff)
	local mid = (ah * bl + al * bh) % 65536
	return (al * bl + mid * 65536) % TWO32
end
Rng.imul = imul

function Rng.createRng(seed)
	return { seed = bit32.band(seed, 0xffffffff) }
end

-- Next float in [0, 1). Mutates the state.
function Rng.nextFloat(rng)
	rng.seed = (rng.seed + 0x6d2b79f5) % TWO32
	local t = rng.seed
	t = imul(bit32.bxor(t, bit32.rshift(t, 15)), bit32.bor(t, 1))
	t = bit32.bxor(t, (t + imul(bit32.bxor(t, bit32.rshift(t, 7)), bit32.bor(t, 61))) % TWO32)
	return bit32.bxor(t, bit32.rshift(t, 14)) / TWO32
end

function Rng.nextRange(rng, lo, hi)
	return lo + (hi - lo) * Rng.nextFloat(rng)
end

return Rng
