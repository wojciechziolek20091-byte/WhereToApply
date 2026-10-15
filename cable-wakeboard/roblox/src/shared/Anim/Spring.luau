-- Damped springs: freq in Hz, damping ratio (1 = critical). Implicit Euler,
-- stable at any frame time. Twin of src/anim/spring.ts.
local Spring = {}

function Spring.spring(x)
	return { x = x or 0, v = 0 }
end

function Spring.step(s, target, p, dt)
	local w = 2 * math.pi * p.freq
	local k = w * w
	local c = 2 * p.damping * w
	s.v = (s.v - dt * k * (s.x - target)) / (1 + dt * c + dt * dt * k)
	s.x += dt * s.v
	return s.x
end

function Spring.impulse(s, dv)
	s.v += dv
end

return Spring
