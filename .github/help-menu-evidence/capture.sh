#!/bin/bash
# Capture the packaged Help menu, then the browser page that What's New and Documentation each open.
set +e -x
label=$1; out=$2; scripts=$3
mkdir -p "$out"
find apps/desktop/.desktop-build -maxdepth 8 -name 'Nexus Superharness.app' -print > "$out/found.txt" 2>/dev/null
app=$(head -1 "$out/found.txt")
[ -n "$app" ] || { echo "no packaged app" > "$out/error.txt"; exit 0; }
proc='Nexus Superharness'
plutil -p "$app/Contents/Info.plist" | grep -E 'CFBundleShortVersionString|CFBundleName' > "$out/info-plist.txt"
# A placeholder key skips the welcome screen; no model request is made.
mkdir -p "$HOME/.dsh"
printf 'DEEPSEEK_API_KEY=sk-evidence-placeholder\n' > "$HOME/.dsh/.env"
DEEPSEEK_API_KEY=sk-evidence-placeholder "$app/Contents/MacOS/$proc" > "$out/app.log" 2>&1 &
sleep 75
front() { osascript -e "tell application \"System Events\" to tell process \"$proc\" to set frontmost to true" >> "$out/osascript.txt" 2>&1; }
front
osascript -e "tell application \"System Events\" to set value of attribute \"AXManualAccessibility\" of process \"$proc\" to true" >> "$out/osascript.txt" 2>&1
sleep 3
screencapture -x "$out/window.png"
osascript "$scripts/menu-items.applescript" "$proc" Help > "$out/menu-help.txt" 2>&1
osascript -e "tell application \"System Events\" to tell process \"$proc\" to click menu bar item \"Help\" of menu bar 1" >> "$out/osascript.txt" 2>&1
sleep 2
screencapture -x "$out/menu-help.png"
osascript -e 'tell application "System Events" to key code 53' >> "$out/osascript.txt" 2>&1
sleep 1
open_item() {
  local item=$1 file=$2
  front
  sleep 1
  osascript -e "tell application \"System Events\" to tell process \"$proc\" to click menu item \"$item\" of menu 1 of menu bar item \"Help\" of menu bar 1" >> "$out/osascript.txt" 2>&1
  sleep 25
  osascript -e 'tell application "System Events" to get name of first process whose frontmost is true' > "$out/$file.txt" 2>&1
  if pgrep -xq 'Google Chrome'; then
    osascript -e 'tell application "Google Chrome" to activate' -e 'tell application "Google Chrome" to get {URL, title} of active tab of front window' >> "$out/$file.txt" 2>&1
  else
    osascript -e 'tell application "Safari" to activate' -e 'tell application "Safari" to get {URL, name} of current tab of front window' >> "$out/$file.txt" 2>&1
  fi
  sleep 3
  screencapture -x "$out/$file.png"
}
open_item "What’s New" opened-whats-new
open_item "Documentation" opened-documentation
pkill -f "$proc"
exit 0
