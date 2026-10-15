-- Prints Sim.Config.DEFAULT_CONFIG and Sim.Park.DEFAULT_PARK as JSON, for the
-- parity test to compare with the TypeScript data. Appended to the Sim bundle.
local function encode(v)
	local t = type(v)
	if t == "number" then
		return string.format("%.17g", v)
	elseif t == "string" then
		return '"' .. v:gsub('[%c"\\]', function(c)
			return string.format("\\u%04x", string.byte(c))
		end) .. '"'
	elseif t == "boolean" then
		return tostring(v)
	elseif t == "table" then
		if #v > 0 or next(v) == nil then
			local out = {}
			for i, x in v do
				out[i] = encode(x)
			end
			return "[" .. table.concat(out, ",") .. "]"
		end
		local keys = {}
		for k in v do
			table.insert(keys, k)
		end
		table.sort(keys)
		local out = {}
		for _, k in keys do
			table.insert(out, encode(k) .. ":" .. encode(v[k]))
		end
		return "{" .. table.concat(out, ",") .. "}"
	end
	error("cannot encode " .. t)
end

print(encode({ config = Sim.Config.DEFAULT_CONFIG, park = Sim.Park.DEFAULT_PARK }))
