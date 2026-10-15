-- Deterministic sin, cos, tan, atan2, log, exp and pow built from + - * / and
-- floor only (fdlibm kernels, Cody-Waite reduction). math.sin and friends differ in the
-- last bit between C libraries and JavaScript engines, which would split the
-- Luau and TypeScript sims apart within seconds; these give the same bits
-- everywhere. Mirrors src/sim/math/trig.ts line for line.
local DetMath = {}

local INV_PIO2 = 6.36619772367581382433e-1
local PIO2_1 = 1.57079632673412561417e0
local PIO2_2 = 6.07710050630396597660e-11
local PIO2_2T = 2.02226624879595063154e-21

local S1 = -1.66666666666666324348e-1
local S2 = 8.33333333332248946124e-3
local S3 = -1.98412698298579493134e-4
local S4 = 2.75573137070700676789e-6
local S5 = -2.50507602534068634195e-8
local S6 = 1.58969099521155010221e-10

local C1 = 4.16666666666666019037e-2
local C2 = -1.38888888888741095749e-3
local C3 = 2.48015872894767294178e-5
local C4 = -2.75573143513906633035e-7
local C5 = 2.08757232129817482790e-9
local C6 = -1.13596475577881948265e-11

-- sin on [-pi/4, pi/4].
local function kernelSin(x)
	local z = x * x
	local v = z * x
	local r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)))
	return x + v * (S1 + z * r)
end

-- cos on [-pi/4, pi/4].
local function kernelCos(x)
	local z = x * x
	local r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))))
	local hz = 0.5 * z
	local w = 1 - hz
	return w + ((1 - w - hz) + z * r)
end

-- x = k * pi/2 + r with |r| <= pi/4. Returns r and k mod 4.
local function reduce(x)
	local k = math.floor(x * INV_PIO2 + 0.5)
	local r = x - k * PIO2_1
	r = r - k * PIO2_2
	r = r - k * PIO2_2T
	return r, k - 4 * math.floor(k / 4)
end

function DetMath.sin(x)
	local r, q = reduce(x)
	if q == 0 then
		return kernelSin(r)
	elseif q == 1 then
		return kernelCos(r)
	elseif q == 2 then
		return -kernelSin(r)
	end
	return -kernelCos(r)
end

function DetMath.cos(x)
	local r, q = reduce(x)
	if q == 0 then
		return kernelCos(r)
	elseif q == 1 then
		return -kernelSin(r)
	elseif q == 2 then
		return -kernelCos(r)
	end
	return kernelSin(r)
end

function DetMath.tan(x)
	return DetMath.sin(x) / DetMath.cos(x)
end

local ATAN_HI = { 4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1, 1.57079632679489655800e0 }
local ATAN_LO = { 2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17 }
local AT0 = 3.33333333333329318027e-1
local AT1 = -1.99999999998764832476e-1
local AT2 = 1.42857142725034663711e-1
local AT3 = -1.11111104054623557880e-1
local AT4 = 9.09088713343650656196e-2
local AT5 = -7.69187620504482999495e-2
local AT6 = 6.66107313738753120669e-2
local AT7 = -5.83357013379057348645e-2
local AT8 = 4.97687799461593236017e-2
local AT9 = -3.65315727442169155270e-2
local AT10 = 1.62858201153657823623e-2

function DetMath.atan(v)
	local neg = v < 0
	local x = if neg then -v else v
	local id
	if x < 0.4375 then
		id = -1
	elseif x < 0.6875 then
		id = 0
		x = (2 * x - 1) / (2 + x)
	elseif x < 1.1875 then
		id = 1
		x = (x - 1) / (x + 1)
	elseif x < 2.4375 then
		id = 2
		x = (x - 1.5) / (1 + 1.5 * x)
	else
		id = 3
		x = -1 / x
	end
	local z = x * x
	local w = z * z
	local s1 = z * (AT0 + w * (AT2 + w * (AT4 + w * (AT6 + w * (AT8 + w * AT10)))))
	local s2 = w * (AT1 + w * (AT3 + w * (AT5 + w * (AT7 + w * AT9))))
	local result
	if id < 0 then
		result = x - x * (s1 + s2)
	else
		-- Tables are 1-based here, 0-based in TypeScript.
		result = ATAN_HI[id + 1] - (x * (s1 + s2) - ATAN_LO[id + 1] - x)
	end
	return if neg then -result else result
end

local PI = 3.141592653589793

-- Angle of (x, y) in (-PI, PI]. atan2(0, 0) = 0.
function DetMath.atan2(y, x)
	if x > 0 then
		return DetMath.atan(y / x)
	elseif x < 0 then
		return if y >= 0 then DetMath.atan(y / x) + PI else DetMath.atan(y / x) - PI
	elseif y > 0 then
		return PI / 2
	elseif y < 0 then
		return -PI / 2
	end
	return 0
end

local LN2_HI = 6.93147180369123816490e-1
local LN2_LO = 1.90821492927058770002e-10
local INV_LN2 = 1.44269504088896338700e0
local SQRT_HALF = 0.7071067811865476
local TWO32 = 4294967296

local LG1 = 6.666666666666735130e-1
local LG2 = 3.999999999940941908e-1
local LG3 = 2.857142874366239149e-1
local LG4 = 2.222219843214978396e-1
local LG5 = 1.818357216161805012e-1
local LG6 = 1.531383769920937332e-1
local LG7 = 1.479819860511658591e-1

-- Natural log for x > 0 (NaN below, -math.huge at 0).
function DetMath.log(x)
	if not (x > 0) then
		return if x == 0 then -math.huge else 0 / 0
	end
	if x == math.huge then
		return x
	end
	-- x = m * 2^k with m in [sqrt(1/2), sqrt(2)), by exact power-of-two scaling.
	local m = x
	local k = 0
	while m < SQRT_HALF / TWO32 do
		m *= TWO32
		k -= 32
	end
	while m >= 2 * TWO32 do
		m /= TWO32
		k += 32
	end
	while m < SQRT_HALF do
		m *= 2
		k -= 1
	end
	while m >= 2 * SQRT_HALF do
		m /= 2
		k += 1
	end
	local f = m - 1
	local s = f / (2 + f)
	local z = s * s
	local w = z * z
	local t1 = w * (LG2 + w * (LG4 + w * LG6))
	local t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)))
	local r = t2 + t1
	local hfsq = 0.5 * f * f
	return k * LN2_HI - (hfsq - (s * (hfsq + r) + k * LN2_LO) - f)
end

local P1 = 1.66666666666666019037e-1
local P2 = -2.77777777770155933842e-3
local P3 = 6.61375632143793436117e-5
local P4 = -1.65339022054652515390e-6
local P5 = 4.13813679705723846039e-8

-- e^x.
function DetMath.exp(x)
	if x ~= x then
		return x
	end
	if x > 709.78 then
		return math.huge
	end
	if x < -745.2 then
		return 0
	end
	local k = math.floor(x * INV_LN2 + 0.5)
	local hi = x - k * LN2_HI
	local lo = k * LN2_LO
	local r = hi - lo
	local t = r * r
	local c = r - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))))
	local y = 1 - (lo - (r * c) / (2 - c) - hi)
	-- y * 2^k by exact power-of-two steps.
	local n = k
	while n > 0 do
		y *= 2
		n -= 1
	end
	while n < -32 do
		y /= TWO32
		n += 32
	end
	while n < 0 do
		y /= 2
		n += 1
	end
	return y
end

-- x^p for x >= 0 (what the sim needs: profile curves).
function DetMath.pow(x, p)
	if p == 0 or x == 1 then
		return 1
	end
	if x == 0 then
		return if p > 0 then 0 else math.huge
	end
	return DetMath.exp(p * DetMath.log(x))
end

return DetMath
