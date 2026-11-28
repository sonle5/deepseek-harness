#!/bin/bash
# Launch the packaged app with a renderer debug port, then capture the new-session page (Issue 62).
set +e -x
label=$1; out=$2; scripts=$3
mkdir -p "$out"
find apps/desktop/.desktop-build -maxdepth 8 -name 'Nexus Superharness.app' -print > "$out/found.txt" 2>/dev/null
app=$(head -1 "$out/found.txt")
[ -n "$app" ] || { echo "no packaged app" > "$out/error.txt"; exit 0; }
proc='Nexus Superharness'

# A placeholder key skips the welcome screen; the one model request fails with an auth error.
mkdir -p "$HOME/.dsh"
printf 'DEEPSEEK_API_KEY=sk-evidence-placeholder\n' > "$HOME/.dsh/.env"

DEEPSEEK_API_KEY=sk-evidence-placeholder "$app/Contents/MacOS/$proc" --remote-debugging-port=9222 > "$out/app.log" 2>&1 &
sleep 20
node "$scripts/drive.mjs" "$label" "$out" > "$out/capture.log" 2>&1
screencapture -x "$out/screen-final.png"
pkill -f "$proc"
exit 0
