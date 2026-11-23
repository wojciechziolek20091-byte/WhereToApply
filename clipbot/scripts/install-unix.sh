#!/bin/bash
# clipbot installer for macOS and Linux. Run by "Install clipbot.command".
set -euo pipefail
APP="$(cd "$(dirname "$0")/.." && pwd -P)"
cd "$APP"

find_uv() {
  if command -v uv >/dev/null 2>&1; then command -v uv; return; fi
  for p in "$HOME/.local/bin/uv" "$HOME/.cargo/bin/uv"; do
    if [ -x "$p" ]; then echo "$p"; return; fi
  done
}

UV="$(find_uv || true)"
if [ -z "$UV" ]; then
  echo "  Step 1 of 3: getting the installer tool (uv)..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
  UV="$(find_uv || true)"
  [ -n "$UV" ] || { echo "  The installer tool (uv) could not be installed."; exit 1; }
else
  echo "  Step 1 of 3: installer tool found."
fi

echo "  Step 2 of 3: downloading clipbot's parts (around 1 GB, only the first time)..."
"$UV" sync --frozen --no-dev

echo "  Step 3 of 3: downloading the speech model..."
"$UV" run --frozen --no-dev clipbot prepare

chmod +x "$APP/Start clipbot.command" "$APP/scripts/start-unix.sh"
case "$(uname)" in
  Darwin)
    ln -sf "$APP/Start clipbot.command" "$HOME/Desktop/clipbot.command"
    ;;
  Linux)
    mkdir -p "$HOME/.local/share/applications"
    DESKTOP_FILE="$HOME/.local/share/applications/clipbot.desktop"
    {
      echo "[Desktop Entry]"
      echo "Type=Application"
      echo "Name=clipbot"
      echo "Comment=Turn long videos into TikTok clips"
      echo "Exec=\"$APP/scripts/start-unix.sh\""
      echo "Icon=$APP/assets/clipbot.png"
      echo "Terminal=true"
      echo "Categories=AudioVideo;"
    } > "$DESKTOP_FILE"
    if [ -d "$HOME/Desktop" ]; then
      cp "$DESKTOP_FILE" "$HOME/Desktop/clipbot.desktop"
      chmod +x "$HOME/Desktop/clipbot.desktop"
    fi
    ;;
esac

echo ""
echo "  Done! clipbot is installed in:"
echo "    $APP"
echo "  Start it any time from the 'clipbot' icon on your desktop."
