--!strict
-- Per-feature stats (spec section 11): hits, clean landings and best trick
-- score per player, keyed by FeatureId. Fed from the sim's events (server:
-- the validated run; client: the local run). A stub store: hook
-- FeatureStats.onRecord to a DataStore or a leaderboard.
local FeatureStats = {}

export type Stat = { hits: number, cleanLandings: number, bestScore: number, bestTrick: string }

local store: { [string]: { [string]: Stat } } = {}

-- Leaderboard hook: called on every new best (player, feature id, stat).
FeatureStats.onRecord = function(_player: string, _featureId: string, _stat: Stat) end

local function statOf(player: string, id: string): Stat
	store[player] = store[player] or {}
	local s = store[player][id]
	if not s then
		s = { hits = 0, cleanLandings = 0, bestScore = 0, bestTrick = "" }
		store[player][id] = s
	end
	return s
end

-- Record one tick's sim events for a player. `tricks` are the run's new trick
-- records ({ trick = { name, points }, featureId }) if the caller has them.
function FeatureStats.record(player: string, events: { any }, tricks: { any }?)
	for _, e in events do
		if e.type == "featureEnter" then
			statOf(player, e.featureId).hits += 1
		elseif e.type == "landed" and e.air and e.air.featureId and e.landing and e.landing.clean then
			statOf(player, e.air.featureId).cleanLandings += 1
		end
	end
	for _, t in tricks or {} do
		if t.featureId then
			local s = statOf(player, t.featureId)
			if t.trick.points > s.bestScore then
				s.bestScore = t.trick.points
				s.bestTrick = t.trick.name
				FeatureStats.onRecord(player, t.featureId, s)
			end
		end
	end
end

function FeatureStats.get(player: string, featureId: string): Stat
	return statOf(player, featureId)
end

function FeatureStats.reset()
	table.clear(store)
end

return FeatureStats
