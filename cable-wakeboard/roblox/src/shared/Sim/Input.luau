-- Everything the player asks for in one tick. Device-agnostic. Mirrors src/sim/input.ts.
--   edge     +1 full heelside .. -1 full toeside (see Edge.carveToEdge)
--   load     hold to bend the knees, release to pop
--   handleIn 1 = handle at the hips, 0 = arms fully out
--   spin     in the air: +1 frontside, -1 backside; on a rail: turn the board
--   flip     at takeoff: +1 front, -1 back
--   raley    hold for a raley
--   grab     held grab id ("indy", "melon", ...) or nil
--   release  let go of the handle
local Input = {}

function Input.neutralInput()
	return { edge = 0, load = false, handleIn = 1, spin = 0, flip = 0, raley = false, grab = nil, release = false }
end

return Input
