#!/bin/bash
# Start clipbot (macOS and Linux).
SELF="$0"
while [ -L "$SELF" ]; do SELF="$(readlink "$SELF")"; done
APP="$(cd "$(dirname "$SELF")/.." && pwd -P)"
cd "$APP"
# Settings, keys and downloads live here, so new versions keep them.
if [ "$(uname)" = "Darwin" ]; then
  export CLIPBOT_HOME="${CLIPBOT_HOME:-$HOME/Library/Application Support/clipbot}"
else
  export CLIPBOT_HOME="${CLIPBOT_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/clipbot}"
fi
UV="$(command -v uv || echo "$HOME/.local/bin/uv")"
"$UV" run --frozen --no-dev clipbot start || {
  echo ""
  echo "  clipbot stopped because of a problem. Take a photo of this window"
  echo "  and send it to whoever gave you clipbot."
  read -n 1 -s -r -p "  Press any key to close."
}
