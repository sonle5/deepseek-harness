#!/bin/bash
# Capture Back/Forward in the title bar (sidebar expanded and collapsed), Find in a conversation, and the View menu.
set +e -x
label=$1; out=$2; scripts=$3
mkdir -p "$out"
find apps/desktop/.desktop-build -maxdepth 8 -name 'Nexus Superharness.app' -print > "$out/found.txt" 2>/dev/null
app=$(head -1 "$out/found.txt")
[ -n "$app" ] || { echo "no packaged app" > "$out/error.txt"; exit 0; }
proc='Nexus Superharness'
# A placeholder key skips the welcome screen; the sent message stays in the transcript when the model request fails.
mkdir -p "$HOME/.dsh"
printf 'DEEPSEEK_API_KEY=sk-evidence-placeholder\n' > "$HOME/.dsh/.env"
DEEPSEEK_API_KEY=sk-evidence-placeholder "$app/Contents/MacOS/$proc" > "$out/app.log" 2>&1 &
sleep 75
sys() { osascript -e "tell application \"System Events\" to tell process \"$proc\" to $1" >> "$out/osascript.txt" 2>&1; }
front() { sys 'set frontmost to true'; }
key() { front; osascript -e "tell application \"System Events\" to $1" >> "$out/osascript.txt" 2>&1; sleep "${2:-2}"; }
front
sys 'set value of attribute "AXManualAccessibility" to true'
sleep 3
screencapture -x "$out/01-start.png"
# Focus the composer: its editable text area is the first AXTextArea in the window.
osascript -e "tell application \"System Events\" to tell process \"$proc\"" \
  -e 'set area to first UI element of entire contents of window 1 whose role is "AXTextArea"' \
  -e 'set {px, py} to position of area' -e 'set {sx, sy} to size of area' \
  -e 'return ((px + sx / 2) as integer as text) & " " & ((py + sy / 2) as integer as text)' -e 'end tell' > "$out/composer-point.txt" 2>&1
read -r cx cy < "$out/composer-point.txt"
[ -n "$cy" ] && swift "$scripts/click.swift" "$cx" "$cy" >> "$out/osascript.txt" 2>&1
sleep 1
key 'keystroke "Compare the release notes with the changelog: release notes list fixes, the changelog lists every release."' 1
key 'key code 36' 10
screencapture -x "$out/02-conversation.png"
# Settings, then close it: Back has no earlier view, Forward returns to Settings.
key 'keystroke "," using command down' 3
screencapture -x "$out/03-settings.png"
key 'key code 53' 3
screencapture -x "$out/04-titlebar-expanded.png"
key 'keystroke "]" using command down' 3
screencapture -x "$out/05-after-forward.png"
key 'keystroke "[" using command down' 3
screencapture -x "$out/06-after-back.png"
# Collapse the sidebar; the arrows follow the toggle beside the traffic lights.
key 'keystroke "b" using command down' 3
screencapture -x "$out/07-titlebar-collapsed.png"
key 'keystroke "b" using command down' 3
# Type a draft, then find from inside the composer.
[ -n "$cy" ] && swift "$scripts/click.swift" "$cx" "$cy" >> "$out/osascript.txt" 2>&1
sleep 1
key 'keystroke "unsent draft"' 1
key 'keystroke "f" using command down' 2
key 'keystroke "release"' 2
screencapture -x "$out/08-find.png"
key 'key code 36' 2
screencapture -x "$out/09-find-next.png"
key 'key code 36 using shift down' 2
key 'key code 36 using shift down' 2
screencapture -x "$out/10-find-previous-wrap.png"
key 'key code 53' 2
screencapture -x "$out/11-find-closed-draft-kept.png"
# View menu: items, enabled state and key equivalents.
osascript "$scripts/menu-items.applescript" "$proc" View > "$out/menu-view.txt" 2>&1
front
sys 'click menu bar item "View" of menu bar 1'
sleep 2
screencapture -x "$out/12-menu-view.png"
key 'key code 53' 1
pkill -f "$proc"
exit 0
