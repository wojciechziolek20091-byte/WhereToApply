-- Edge angle build/release, board heading, toe side. Mirrors src/sim/edge.ts.
local Scalar = require(script.Parent.Scalar)

local Edge = {}

-- +1 when the rider's toes point to the right of the direction of travel.
function Edge.toeSign(r)
	return (if r.stance == "regular" then 1 else -1) * (if r.switchStance then -1 else 1)
end

-- Screen-style carve (+1 = to the rider's right of travel) to the sim's edge request.
function Edge.carveToEdge(r, carve)
	return -Edge.toeSign(r) * carve
end

function Edge.carveSide(r)
	return -Edge.toeSign(r) * Scalar.sign(r.edgeAngle)
end

function Edge.maxHoldableEdge(r, cfg)
	return cfg.maxEdgeAngle * (0.6 + 0.4 * Scalar.clamp01(r.connection))
end

-- Loading is slow (progressive edge), flattening is fast.
function Edge.updateEdge(r, request, cfg, dt)
	local limit = Edge.maxHoldableEdge(r, cfg)
	local target = Scalar.clamp(request, -1, 1) * limit
	local loading = math.abs(target) > math.abs(r.edgeAngle) and Scalar.sign(target) ~= -Scalar.sign(r.edgeAngle)
	local rate = if loading then cfg.edgeBuildRate else cfg.edgeReleaseRate
	r.edgeAngle = Scalar.clamp(Scalar.approach(r.edgeAngle, target, rate * dt), -limit, limit)
end

function Edge.edgeNorm(r, cfg)
	return Scalar.clamp01(math.abs(r.edgeAngle) / cfg.maxEdgeAngle)
end

-- Rope tight: the edge holds a cut angle to the rope. Slack: the edge carves a turn.
function Edge.updateHeading(r, ropeHeading, tension, speed, cfg, dt)
	local e = r.edgeAngle / cfg.maxEdgeAngle
	local side = -Edge.toeSign(r)
	local target = ropeHeading + side * cfg.maxCutAngle * e
	local ropeYaw = cfg.yawResponse * Scalar.wrapAngle(target - r.heading)
	local carveYaw = side * cfg.carveCurvature * speed * e
	local w = Scalar.clamp01(tension / cfg.ropeControlTension)
	local yawRate = Scalar.clamp(w * ropeYaw + (1 - w) * carveYaw, -cfg.maxYawRate, cfg.maxYawRate)
	r.heading = Scalar.wrapAngle(r.heading + yawRate * dt)
end

function Edge.cutAngle(heading, ropeHeading)
	return Scalar.wrapAngle(heading - ropeHeading)
end

return Edge
