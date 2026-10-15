--!strict
--[[
	WakeServer: score validation and the leaderboard (spec section 11.5).

	Riding physics runs on the client (WakeClient). The client reports tricks,
	crashes and finished combos through RemoteEvents in ReplicatedStorage.WakeRemotes;
	the server recomputes each combo with the shared Sim.ScoringCombo (the same
	code the client used) and rejects data that is not physically possible
	before it reaches leaderstats (Points, Best Combo).
]]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local shared = ReplicatedStorage:WaitForChild("WakeShared")
local Sim = require(shared:WaitForChild("Sim"))
local ComboValidator = require(shared:WaitForChild("ComboValidator"))
local cfg = Sim.Config.DEFAULT_CONFIG

local remotes = Instance.new("Folder")
remotes.Name = "WakeRemotes"
local function remote(name: string): RemoteEvent
	local r = Instance.new("RemoteEvent")
	r.Name = name
	r.Parent = remotes
	return r
end
local TrickLanded = remote("TrickLanded")
local ComboEnded = remote("ComboEnded")
local Crashed = remote("Crashed")
remotes.Parent = ReplicatedStorage

local function setupStats(player: Player)
	local stats = Instance.new("Folder")
	stats.Name = "leaderstats"
	local points = Instance.new("IntValue")
	points.Name = "Points"
	points.Parent = stats
	local best = Instance.new("IntValue")
	best.Name = "Best Combo"
	best.Parent = stats
	stats.Parent = player
end
Players.PlayerAdded:Connect(setupStats)
for _, p in Players:GetPlayers() do
	setupStats(p)
end

ComboEnded.OnServerEvent:Connect(function(player: Player, tricks: any, claimed: any)
	local score, err = ComboValidator.validate(tricks, cfg)
	if not score then
		warn(`[WakeServer] {player.Name}: rejected combo ({err})`)
		return
	end
	if type(claimed) == "number" and claimed ~= score.total then
		warn(`[WakeServer] {player.Name}: claimed {claimed}, recomputed {score.total}; using the recomputed score`)
	end
	local stats = player:FindFirstChild("leaderstats")
	if stats then
		local points = stats:FindFirstChild("Points") :: IntValue
		local best = stats:FindFirstChild("Best Combo") :: IntValue
		points.Value += score.total
		best.Value = math.max(best.Value, score.total)
	end
end)

TrickLanded.OnServerEvent:Connect(function(_player: Player, _info: any)
	-- Informational (other players' feeds, analytics); combos carry the score.
end)

Crashed.OnServerEvent:Connect(function(player: Player, reason: any)
	if cfg.debug.enabled then
		print(`[WakeServer] {player.Name} crashed: {tostring(reason)}`)
	end
end)
