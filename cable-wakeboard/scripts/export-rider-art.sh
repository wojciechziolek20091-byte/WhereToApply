#!/usr/bin/env sh
# Regenerate src/art/riderParts.json from the Luau RiderBuilder (the single
# source of truth for rider art, shared with Roblox). Needs the `luau` CLI.
# Usage: scripts/export-rider-art.sh [path/to/luau]
set -e
LUAU="${1:-luau}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
R="$ROOT/roblox"
OUT="$(mktemp -d)/export.luau"
{
  cat "$R/tests/mock_roblox.luau"
  echo 'local RiderBuilder = (function()'
  sed 's/^--!strict//' "$R/src/shared/RiderBuilder.luau"
  echo 'end)()'
  cat "$R/tests/export_parts.luau"
} > "$OUT"
"$LUAU" "$OUT" > "$ROOT/src/art/riderParts.json"
echo "wrote src/art/riderParts.json"
