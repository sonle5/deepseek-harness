#!/bin/bash
# Capture each opened menu of the packaged app, then rebind New Session in Settings → Shortcuts and capture File again.
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

launch() {
  DEEPSEEK_API_KEY=sk-evidence-placeholder "$app/Contents/MacOS/$proc" > "$out/app-$1.log" 2>&1 &
  sleep 60
  osascript -e "tell application \"System Events\" to tell process \"$proc\" to set frontmost to true" \
            -e "tell application \"System Events\" to set value of attribute \"AXManualAccessibility\" of process \"$proc\" to true" >> "$out/osascript.txt" 2>&1
  sleep 3
}

menus() {
  osascript -e "tell application \"System Events\" to tell process \"$proc\" to get name of every menu bar item of menu bar 1" > "$out/menu-bar-$1.txt" 2>&1
}

# Open one top-level menu, capture it, and record each item's name, enabled state and key equivalent.
capture_menu() {
  local name=$1 file=$2
  osascript "$scripts/menu-items.applescript" "$proc" "$name" > "$out/$file.txt" 2>&1
  osascript -e "tell application \"System Events\" to tell process \"$proc\" to click menu bar item \"$name\" of menu bar 1" >> "$out/osascript.txt" 2>&1
  sleep 2
  screencapture -x "$out/$file.png"
  osascript -e 'tell application "System Events" to key code 53' >> "$out/osascript.txt" 2>&1
  sleep 1
}

launch first
screencapture -x "$out/window.png"
menus first
for name in "$proc" File Edit View Window Help; do
  grep -q "$name" "$out/menu-bar-first.txt" && capture_menu "$name" "menu-$(echo "$name" | tr ' A-Z' '-a-z')"
done

if [ "$label" = after ]; then
  # Help → Keyboard Shortcuts, edit New Session, press ⇧⌘J; File then shows the new key without a restart.
  osascript -e "tell application \"System Events\" to tell process \"$proc\" to click menu item \"Keyboard Shortcuts\" of menu 1 of menu bar item \"Help\" of menu bar 1" >> "$out/osascript.txt" 2>&1
  sleep 3
  screencapture -x "$out/shortcuts-dialog.png"
  osascript "$scripts/click-button.applescript" "$proc" "Edit shortcut for New Session" > "$out/rebind-click.txt" 2>&1
  sleep 2
  screencapture -x "$out/shortcuts-recording.png"
  osascript -e 'tell application "System Events" to keystroke "j" using {command down, shift down}' >> "$out/osascript.txt" 2>&1
  sleep 3
  screencapture -x "$out/shortcuts-rebound.png"
  osascript -e 'tell application "System Events" to key code 53' >> "$out/osascript.txt" 2>&1
  sleep 1
  osascript -e 'tell application "System Events" to key code 53' >> "$out/osascript.txt" 2>&1
  sleep 1
  capture_menu File menu-file-rebound
  cp "$HOME/Library/Application Support/@deepseek-ai/dsh-desktop/keybindings.json" "$out/keybindings.json" 2>> "$out/osascript.txt"
fi
pkill -f "$proc"
exit 0
