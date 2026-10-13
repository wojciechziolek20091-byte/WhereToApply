#!/usr/bin/env sh
# Run the Luau smoke tests with the plain `luau` CLI (https://github.com/luau-lang/luau).
# Luau sandboxes globals per module, so mock + module + spec are bundled into one script.
# Usage: tests/run.sh [path/to/luau]
set -e
LUAU="${1:-luau}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mktemp -d)/bundle.luau"
{
  cat "$DIR/tests/mock_roblox.luau"
  echo 'local RiderBuilder = (function()'
  sed 's/^--!strict//' "$DIR/src/shared/RiderBuilder.luau"
  echo 'end)()'
  grep -v '^require(\|^local RiderBuilder = require' "$DIR/tests/rider_spec.luau"
} > "$OUT"
"$LUAU" "$OUT"
