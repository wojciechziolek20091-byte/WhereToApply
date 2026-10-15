#!/usr/bin/env sh
# Build the game and stage it for publishing as a claude.ai artifact page:
# copies dist/assets/* next to a page that loads assets/game.js. Babylon loads
# its shaders as separate chunks, so every file in dist/assets must ship.
# Usage: scripts/stage-artifact.sh <staging-dir>
set -e
DEST="${1:?staging dir}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
(cd "$ROOT" && npx vite build)
rm -rf "$DEST/assets"
mkdir -p "$DEST/assets"
cp "$ROOT"/dist/assets/*.js "$DEST/assets/"
echo "staged $(ls "$DEST/assets" | wc -l) files in $DEST/assets"
