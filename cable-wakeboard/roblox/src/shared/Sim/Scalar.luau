-- Scalar helpers. Mirrors src/sim/math/scalar.ts, including JavaScript's
-- remainder semantics: JS `%` truncates (math.fmod), Luau `%` floors.
local Scalar = {}

local PI = math.pi
local TAU = PI * 2
Scalar.TAU = TAU

local function clamp(v, lo, hi)
	if v < lo then
		return lo
	elseif v > hi then
		return hi
	end
	return v
end
Scalar.clamp = clamp
function Scalar.clamp01(v)
	return clamp(v, 0, 1)
end
function Scalar.lerp(a, b, t)
	return a + (b - a) * t
end
-- Like Math.sign for finite numbers: 1, -1 or 0.
function Scalar.sign(v)
	if v > 0 then
		return 1
	elseif v < 0 then
		return -1
	end
	return 0
end

-- Wrap an angle to (-PI, PI].
function Scalar.wrapAngle(a)
	local r = math.fmod(a, TAU)
	if r <= -PI then
		r += TAU
	elseif r > PI then
		r -= TAU
	end
	return r
end

-- Wrap an angle to (-PI/2, PI/2]: the distance to the nearest half turn.
function Scalar.wrapHalfTurn(a)
	local r = math.fmod(a, PI)
	if r <= -PI / 2 then
		r += PI
	elseif r > PI / 2 then
		r -= PI
	end
	return r
end

-- Move `current` toward `target` by at most `maxDelta`.
function Scalar.approach(current, target, maxDelta)
	local d = target - current
	if math.abs(d) <= maxDelta then
		return target
	end
	return current + Scalar.sign(d) * maxDelta
end

function Scalar.smoothstep(edge0, edge1, x)
	local t = Scalar.clamp01((x - edge0) / (edge1 - edge0))
	return t * t * (3 - 2 * t)
end

-- Positive modulo, as ((a % n) + n) % n in JavaScript.
function Scalar.mod(a, n)
	return math.fmod(math.fmod(a, n) + n, n)
end

-- JavaScript's Math.round: halves round toward +infinity.
function Scalar.round(x)
	return math.floor(x + 0.5)
end

return Scalar
