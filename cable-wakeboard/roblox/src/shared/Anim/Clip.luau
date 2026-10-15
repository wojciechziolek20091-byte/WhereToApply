-- Pose clips: keys at normalised time t in [0, 1], sampled with cubic Hermite
-- curves (Catmull-Rom tangents, flat ends), never linearly. Twin of
-- src/anim/clip.ts.
local Channels = require(script.Parent.Channels)
local Skeleton = require(script.Parent.Skeleton)

local CH, NCH = Channels.CH, Channels.NCH
local Clip = {}

local function keyChannels(k)
	local out = {}
	local function put(name, v)
		if v ~= nil then
			table.insert(out, { CH[name], v })
		end
	end
	for _, j in Skeleton.JOINTS do
		local r = k.joints and k.joints[j]
		if r then
			put(j .. ".x", r.x)
			put(j .. ".y", r.y)
			put(j .. ".z", r.z)
		end
	end
	for _, g in { "pelvis", "handle", "board" } do
		local r = k[g]
		if r then
			put(g .. ".x", r.x)
			put(g .. ".y", r.y)
			put(g .. ".z", r.z)
		end
	end
	if k.knee ~= nil then
		local a, b
		if type(k.knee) == "number" then
			a, b = k.knee, k.knee
		else
			a, b = k.knee[1], k.knee[2]
		end
		put("kneeL", a)
		put("kneeR", b)
	end
	put("tuck", k.tuck)
	put("aim", k.aim)
	return out
end

function Clip.compileClip(clip)
	local keys = table.clone(clip.keys)
	table.sort(keys, function(a, b)
		return a.t < b.t
	end)
	local byCh = {}
	for _, k in keys do
		for _, cv in keyChannels(k) do
			local ch, v = cv[1], cv[2]
			local tr = byCh[ch]
			if not tr then
				tr = { t = {}, v = {}, ease = {} }
				byCh[ch] = tr
			end
			table.insert(tr.t, k.t)
			table.insert(tr.v, v)
			table.insert(tr.ease, k.ease or "smooth")
		end
	end
	local mask = table.create(NCH, 0)
	local tracks = {}
	for ch = 1, NCH do
		local tr = byCh[ch]
		if tr then
			mask[ch] = 1
			table.insert(tracks, { ch = ch, t = tr.t, v = tr.v, ease = tr.ease })
		end
	end
	return { name = clip.name, loop = clip.loop == true, tracks = tracks, mask = mask }
end

local function shape(s, e)
	if e == "in" then
		return s * s
	elseif e == "out" then
		return 1 - (1 - s) * (1 - s)
	end
	return s
end

function Clip.sampleTrack(t, v, ease, u)
	local n = #t
	if n == 1 or u <= t[1] then
		return v[1]
	end
	if u >= t[n] then
		return v[n]
	end
	local i = 1
	while i < n - 1 and u > t[i + 1] do
		i += 1
	end
	local t0, t1 = t[i], t[i + 1]
	local h = t1 - t0
	local s = shape(if h > 0 then (u - t0) / h else 1, ease[i])
	local p0, p1 = v[i], v[i + 1]
	local m0 = if i > 1 then ((p1 - v[i - 1]) / (t1 - t[i - 1])) * h else 0
	local m1 = if i + 2 <= n then ((v[i + 2] - p0) / (t[i + 2] - t0)) * h else 0
	local s2 = s * s
	local s3 = s2 * s
	return (2 * s3 - 3 * s2 + 1) * p0 + (s3 - 2 * s2 + s) * m0 + (-2 * s3 + 3 * s2) * p1 + (s3 - s2) * m1
end

function Clip.sampleClip(c, u, out)
	local t = u
	if c.loop then
		t = t - math.floor(t)
	end
	for _, tr in c.tracks do
		out[tr.ch] = Clip.sampleTrack(tr.t, tr.v, tr.ease, t)
	end
end

return Clip
