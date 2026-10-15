--!strict
-- The body in the rotation (animation spec section 11): tucked turns faster,
-- open turns slower, with a whole flip taking as long as at the old input
-- rate. Pre-wind, landing speed cost. Twin of src/sim/bodyPhysics.ts.
local Scalar = require(script.Parent.Scalar)

local TAU = Scalar.TAU
local BodyPhysics = {}

-- Piecewise-linear lookup in {x, y} keys sorted by x, clamped at the ends.
function BodyPhysics.piecewise(keys: { { number } }, x: number): number
	local n = #keys
	if x <= keys[1][1] then
		return keys[1][2]
	end
	for i = 2, n do
		local k1 = keys[i]
		if x <= k1[1] then
			local k0 = keys[i - 1]
			local t = (x - k0[1]) / (k1[1] - k0[1])
			return k0[2] + (k1[2] - k0[2]) * t
		end
	end
	return keys[n][2]
end

function BodyPhysics.inertiaGain(open: number, tucked: number, tuck: number): number
	return open / (open + (tucked - open) * tuck)
end

function BodyPhysics.flipTuckAt(cfg: any, p: number): number
	return BodyPhysics.piecewise(cfg.physics.flipTuck, p)
end

function BodyPhysics.flipRateScale(cfg: any, flipAngle: number): number
	local ph = cfg.physics
	if not ph.tuckRotation then
		return 1
	end
	local turns = math.abs(flipAngle) / TAU
	local p = turns - math.floor(turns)
	local k = 0
	local n = 64
	for i = 0, n - 1 do
		k += 1 / BodyPhysics.inertiaGain(ph.flipInertiaOpen, ph.flipInertiaTucked, BodyPhysics.flipTuckAt(cfg, (i + 0.5) / n))
	end
	k = k / n
	return BodyPhysics.inertiaGain(ph.flipInertiaOpen, ph.flipInertiaTucked, BodyPhysics.flipTuckAt(cfg, p)) * k
end

function BodyPhysics.spinTuck(cfg: any, rot: any): number
	local ph = cfg.physics
	local t = Scalar.clamp01(rot.spinTime / ph.spinTuckIn)
	if rot.spinTarget ~= nil then
		t = t * Scalar.clamp01(math.abs(rot.spinTarget - rot.spinAngle) / ph.spinOpen)
	end
	return t
end

function BodyPhysics.spinRateScale(cfg: any, rot: any): number
	local ph = cfg.physics
	if not ph.tuckRotation then
		return 1
	end
	return BodyPhysics.inertiaGain(ph.spinInertiaOpen, ph.spinInertiaTucked, BodyPhysics.spinTuck(cfg, rot))
		/ BodyPhysics.inertiaGain(ph.spinInertiaOpen, ph.spinInertiaTucked, 1)
end

function BodyPhysics.preWindScale(cfg: any, preWind: number, spinDir: number): number
	return if cfg.physics.preWind and preWind ~= 0 and spinDir == preWind then 1 + cfg.physics.preWindBonus else 1
end

function BodyPhysics.landingSpeedKeep(cfg: any, impact: number, clean: boolean): number
	local ph = cfg.physics
	if not ph.landingSpeedCost then
		return 1
	end
	local cost = ph.landingCostPerMS * impact * (if clean then 1 else ph.sketchyCost)
	return 1 - math.min(0.5, cost)
end

return BodyPhysics
