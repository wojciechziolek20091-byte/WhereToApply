#!/bin/bash
# Double-click to install clipbot (macOS). On Linux, run it from a terminal.
SELF="$0"
while [ -L "$SELF" ]; do SELF="$(readlink "$SELF")"; done
cd "$(dirname "$SELF")"
echo ""
echo "  Installing clipbot. The first time takes a few minutes."
echo "  Please keep this window open."
echo ""
if bash scripts/install-unix.sh; then
  echo ""
else
  echo ""
  echo "  Something went wrong. Take a photo of this window and send it"
  echo "  to whoever gave you clipbot."
fi
read -n 1 -s -r -p "  Press any key to close this window."
