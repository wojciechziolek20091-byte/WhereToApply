-- Held keys -> the sim's InputFrame. Mirrors Keyboard.frame() in
-- src/game/keyboard.ts, so a key does the same thing on the web and in Roblox.
-- Pure: `held` is a set of key names (Enum.KeyCode names, e.g. held.Space = true),
-- so this runs (and is tested) outside Studio too.
local Sim = require(script.Parent.Sim)

local WakeInput = {}

-- Grab keys, checked in order; the first held wins.
local GRAB_KEYS = {
	{ "J", "indy" },
	{ "K", "melon" },
	{ "L", "mute" },
	{ "I", "stalefish" },
	{ "U", "nose" },
	{ "O", "tail" },
}

WakeInput.CONTROLS_HELP = {
	"A/D or arrows: carve (water), spin (air), lean to balance (rail)",
	"F on a rail: turn the board across (boardslide)",
	"Space: hold to load, release to pop",
	"W / S held at pop: front / back invert",
	"Shift: arms out (bad posture)",
	"J K L I U O: indy melon mute stalefish nose tail",
	"R: raley   Q: let go   Enter: restart",
}

local function b(v)
	return if v then 1 else 0
end

function WakeInput.frame(rider, held)
	-- +1 = to the rider's right of travel / clockwise seen from above.
	local steer = b(held.D or held.Right) - b(held.A or held.Left)
	local up = b(held.W or held.Up)
	local down = b(held.S or held.Down)
	local airborne = rider.mode == "air"
	local onRail = rider.jib ~= nil
	-- Spin input is in frontside units; clockwise yaw is frontside when -toeSign is +1.
	local switchStance = if rider.air then rider.air.takeoffSwitch else rider.switchStance
	local toes = Sim.Edge.toeSign({ stance = rider.stance, switchStance = switchStance })
	local spin = if airborne then -toes * steer elseif onRail and held.F then 1 else 0
	local grab = nil
	for _, pair in GRAB_KEYS do
		if held[pair[1]] then
			grab = pair[2]
			break
		end
	end
	return {
		edge = if airborne then 0 else Sim.Edge.carveToEdge(rider, steer),
		load = held.Space == true,
		handleIn = if held.LeftShift or held.RightShift then 0 else 1,
		spin = spin,
		flip = up - down,
		raley = held.R == true,
		grab = grab,
		release = held.Q == true,
	}
end

return WakeInput
