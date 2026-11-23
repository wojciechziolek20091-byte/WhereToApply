#!/bin/bash
# Double-click to start clipbot (macOS).
SELF="$0"
while [ -L "$SELF" ]; do SELF="$(readlink "$SELF")"; done
exec bash "$(dirname "$SELF")/scripts/start-unix.sh"
