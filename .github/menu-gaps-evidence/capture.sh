#!/bin/bash
# Capture the File, View, Window and Help menus of the packaged app, their Accessibility dump, and full-screen behavior.
set +e -x
label=$1; out=$2; scripts=$3
mkdir -p "$out"
sw_vers > "$out/os.txt" 2>&1
find apps/desktop/.desktop-build -maxdepth 8 -name 'Nexus Superharness.app' -print > "$out/found.txt" 2>/dev/null
app=$(head -1 "$out/found.txt")
[ -n "$app" ] || { echo "no packaged app" > "$out/error.txt"; exit 0; }
proc='Nexus Superharness'
# A placeholder key skips the welcome screen; no model request is sent.
mkdir -p "$HOME/.dsh"
printf 'DEEPSEEK_API_KEY=sk-evidence-placeholder\n' > "$HOME/.dsh/.env"
DEEPSEEK_API_KEY=sk-evidence-placeholder "$app/Contents/MacOS/$proc" > "$out/app.log" 2>&1 &
sleep 75
sys() { osascript -e "tell application \"System Events\" to tell process \"$proc\" to $1" >> "$out/osascript.txt" 2>&1; }
front() { sys 'set frontmost to true'; }
key() { front; osascript -e "tell application \"System Events\" to $1" >> "$out/osascript.txt" 2>&1; sleep "${2:-2}"; }
window() { osascript -e "tell application \"System Events\" to tell process \"$proc\" to get {name, position, size, value of attribute \"AXFullScreen\"} of window 1" > "$out/window-$1.txt" 2>&1; }
front
sleep 3
osascript -e "tell application \"System Events\" to tell process \"$proc\" to get name of every menu bar item of menu bar 1" > "$out/menu-bar.txt" 2>&1
n=1
for menu in File View Window Help; do
  osascript "$scripts/menu-items.applescript" "$proc" "$menu" > "$out/menu-$(echo "$menu" | tr 'A-Z' 'a-z').txt" 2>&1
  front
  sys "click menu bar item \"$menu\" of menu bar 1"
  sleep 2
  screencapture -x "$out/0$n-menu-$(echo "$menu" | tr 'A-Z' 'a-z').png"
  key 'key code 53' 1
  n=$((n + 1))
done
# Window menu with Option held, for alternate items such as Minimize All.
front
osascript -e 'tell application "System Events" to key down option' >> "$out/osascript.txt" 2>&1
sys 'click menu bar item "Window" of menu bar 1'
sleep 2
screencapture -x "$out/03b-menu-window-option.png"
osascript -e 'tell application "System Events" to key up option' >> "$out/osascript.txt" 2>&1
key 'key code 53' 1
window initial
# Control+Command+F toggles full screen; a second press leaves it.
key 'keystroke "f" using {control down, command down}' 5
window after-ctrl-cmd-f
screencapture -x "$out/05-full-screen.png"
osascript "$scripts/menu-items.applescript" "$proc" View > "$out/menu-view-full-screen.txt" 2>&1
key 'keystroke "f" using {control down, command down}' 5
window after-second-ctrl-cmd-f
# Window → Fill and Window → Center, when present.
sys 'click menu item "Fill" of menu 1 of menu bar item "Window" of menu bar 1'
sleep 3
window after-fill
sys 'click menu item "Center" of menu 1 of menu bar item "Window" of menu bar 1'
sleep 3
window after-center
pkill -f "$proc"
exit 0
