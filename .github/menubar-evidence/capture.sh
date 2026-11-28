#!/bin/bash
# Capture each top-level menu of the packaged app, and the Help → Troubleshooting submenu where it exists.
set +e -x
label=$1; out=$2; scripts=$3
mkdir -p "$out"
find apps/desktop/.desktop-build -maxdepth 8 -name 'Nexus Superharness.app' -print > "$out/found.txt" 2>/dev/null
app=$(head -1 "$out/found.txt")
[ -n "$app" ] || { echo "no packaged app" > "$out/error.txt"; exit 0; }
proc='Nexus Superharness'
# A placeholder key skips the welcome screen; no model request is made.
mkdir -p "$HOME/.dsh"
printf 'DEEPSEEK_API_KEY=sk-evidence-placeholder\n' > "$HOME/.dsh/.env"
DEEPSEEK_API_KEY=sk-evidence-placeholder "$app/Contents/MacOS/$proc" > "$out/app.log" 2>&1 &
sleep 75
osascript -e "tell application \"System Events\" to tell process \"$proc\" to set frontmost to true" \
          -e "tell application \"System Events\" to set value of attribute \"AXManualAccessibility\" of process \"$proc\" to true" >> "$out/osascript.txt" 2>&1
sleep 3
screencapture -x "$out/window.png"
osascript -e "tell application \"System Events\" to tell process \"$proc\" to get name of every menu bar item of menu bar 1" > "$out/menu-bar.txt" 2>&1
capture_menu() {
  local name=$1 file=$2
  osascript "$scripts/menu-items.applescript" "$proc" "$name" > "$out/$file.txt" 2>&1
  osascript -e "tell application \"System Events\" to tell process \"$proc\" to click menu bar item \"$name\" of menu bar 1" >> "$out/osascript.txt" 2>&1
  sleep 2
  screencapture -x "$out/$file.png"
  if [ "$name" = Help ] && grep -q '^Troubleshooting' "$out/$file.txt"; then
    osascript -e "tell application \"System Events\" to tell process \"$proc\" to click menu item \"Troubleshooting\" of menu 1 of menu bar item \"Help\" of menu bar 1" >> "$out/osascript.txt" 2>&1
    sleep 2
    screencapture -x "$out/menu-help-troubleshooting.png"
    osascript -e 'tell application "System Events" to key code 53' >> "$out/osascript.txt" 2>&1
    sleep 1
  fi
  osascript -e 'tell application "System Events" to key code 53' >> "$out/osascript.txt" 2>&1
  sleep 1
}
for name in "$proc" File View Help; do
  grep -q "$name" "$out/menu-bar.txt" && capture_menu "$name" "menu-$(echo "$name" | tr ' A-Z' '-a-z')"
done
pkill -f "$proc"
exit 0
