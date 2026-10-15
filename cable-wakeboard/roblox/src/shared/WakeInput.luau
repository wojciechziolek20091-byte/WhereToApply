-- Actions and their default bindings, and held actions -> the sim's raw
-- InputFrame. Twin of Keyboard.frame() in src/game/keyboard.ts, so the keys do
-- the same thing on the web and in Roblox. Pure: the client binds ACTIONS with
-- ContextActionService (so keys can be rebound and gamepads work) and passes
-- the set of held action names.
local WakeInput = {}

-- Action name -> default inputs (Enum.KeyCode names). Rebind by editing this table.
WakeInput.ACTIONS = {
	SteerLeft = { "A", "Left", "DPadLeft" },
	SteerRight = { "D", "Right", "DPadRight" },
	Pop = { "Space", "ButtonA" },
	Forward = { "W", "Up", "DPadUp" },
	Back = { "S", "Down", "DPadDown" },
	HandlePass = { "Q", "ButtonX" },
	Grab = { "E", "ButtonB" },
	GrabStalefish = { "R", "ButtonL1" },
	GrabNose = { "N", "ButtonR1" },
	GrabTail = { "T", "ButtonL2" },
	ArmsOut = { "LeftShift", "RightShift" },
	LetGo = { "X", "ButtonY" },
	Restart = { "Return", "ButtonStart" },
	Debug = { "F3" },
}

WakeInput.CONTROLS_HELP = {
	"A/D: carve (water), rotate the board (box/rail), spin (air)",
	"Space: hold to charge, release to pop. Edge hard away from the line until LOADED (1000 N) for a raley",
	"S + Space / W + Space when LOADED: backroll / frontroll",
	"W / S in the air: front flip / tantrum. A/D in a raley: S-bend",
	"Q: handle pass in the window (no pass on a backside spin = to blind)",
	"Blind: tap A/D the way you came to spin out, or pop and spin out",
	"E: indy. E+R stalefish, E+N nose, E+T tail. Let go before landing",
	"Box/rail: tap A/D to balance, hold to rotate 90. Shift: arms out. X: let go",
	"Enter: restart   F3: debug",
}

local function b(v)
	return if v then 1 else 0
end

-- `held` is a set of action names; `analogSteer` (thumbstick, -1..1) overrides A/D when set.
function WakeInput.frame(held, analogSteer)
	local steer = b(held.SteerRight) - b(held.SteerLeft)
	if analogSteer and math.abs(analogSteer) > 0.5 then
		steer = if analogSteer > 0 then 1 else -1
	end
	local grabMod = nil
	if held.GrabStalefish then
		grabMod = "stalefish"
	elseif held.GrabNose then
		grabMod = "nose"
	elseif held.GrabTail then
		grabMod = "tail"
	end
	return {
		steer = steer,
		pop = held.Pop == true,
		forward = held.Forward == true,
		back = held.Back == true,
		pass = held.HandlePass == true,
		grab = held.Grab == true,
		grabMod = grabMod,
		armsOut = held.ArmsOut == true,
		letGo = held.LetGo == true,
	}
end

return WakeInput
