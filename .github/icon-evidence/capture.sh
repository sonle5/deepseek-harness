#!/bin/bash
# Capture the packaged app's Dock tile, its DMG window and a Finder icon view, and export the packaged ICNS files.
set +e -x
label=$1; out=$2
mkdir -p "$out"
find apps/desktop/.desktop-build -maxdepth 8 \( -name 'Nexus Superharness.app' -o -name '*.dmg' \) -print > "$out/found.txt" 2>/dev/null
app=$(grep -m1 'Nexus Superharness.app$' "$out/found.txt")
dmg=$(grep -m1 '\.dmg$' "$out/found.txt")
[ -n "$app" ] || { echo "no packaged app" > "$out/error.txt"; exit 0; }
proc='Nexus Superharness'
sw_vers > "$out/sw_vers.txt"

# Packaged icon files and their decoded representations.
cp "$app/Contents/Resources/icon.icns" "$out/app-icon.icns"
plutil -p "$app/Contents/Info.plist" | grep -iE 'CFBundleIcon' > "$out/info-plist-icon.txt"
ls "$app/Contents/Resources" > "$out/resources.txt"
iconutil --convert iconset --output "$RUNNER_TEMP/app.iconset" "$out/app-icon.icns"
cp -R "$RUNNER_TEMP/app.iconset" "$out/app.iconset"

# A clean Dock: Finder, Safari, the app, then System Settings, at a large fixed tile size.
defaults write com.apple.dock persistent-apps -array
for path in /Applications/Safari.app "$app" "/System/Applications/System Settings.app"; do
  defaults write com.apple.dock persistent-apps -array-add "<dict><key>tile-data</key><dict><key>file-data</key><dict><key>_CFURLString</key><string>file://${path// /%20}/</string><key>_CFURLStringType</key><integer>15</integer></dict></dict></dict>"
done
defaults write com.apple.dock tilesize -int 96
defaults write com.apple.dock magnification -bool false
defaults write com.apple.dock show-recents -bool false
defaults write com.apple.dock autohide -bool false
killall Dock; sleep 8
osascript -e 'tell application "Finder" to close every window' >> "$out/osascript.txt" 2>&1
screencapture -x "$out/dock-full.png"
read -r width height < <(sips -g pixelWidth -g pixelHeight "$out/dock-full.png" | awk '/pixel/{print $2}' | xargs)
crop=$((height / 4))
sips --cropToHeightWidth "$crop" "$width" --cropOffset $((height - crop)) 0 "$out/dock-full.png" --out "$out/dock.png" >> "$out/sips.txt" 2>&1

# Finder icon view of a folder holding the app beside two system apps.
view="$RUNNER_TEMP/Icon view"
mkdir -p "$view"
ditto "$app" "$view/$proc.app"
ln -s /Applications/Safari.app "$view/Safari"
ln -s "/System/Applications/System Settings.app" "$view/System Settings"
osascript >> "$out/osascript.txt" 2>&1 <<APPLESCRIPT
tell application "Finder"
  activate
  set w to make new Finder window to (POSIX file "$view" as alias)
  set current view of w to icon view
  set icon size of icon view options of w to 128
  set bounds of w to {120, 120, 900, 520}
end tell
APPLESCRIPT
sleep 6
screencapture -x "$out/finder-icon-view.png"
osascript -e 'tell application "Finder" to close every window' >> "$out/osascript.txt" 2>&1

# The DMG window as electron-builder lays it out, and its volume icon.
if [ -n "$dmg" ]; then
  hdiutil attach "$dmg" | tee "$out/hdiutil.txt"
  vol=$(ls -d /Volumes/Nexus* 2>/dev/null | head -1)
  cp "$vol/.VolumeIcon.icns" "$out/volume-icon.icns"
  cmp "$out/volume-icon.icns" "$out/app-icon.icns" > "$out/volume-icon-cmp.txt" 2>&1; echo "cmp exit $?" >> "$out/volume-icon-cmp.txt"
  open "$vol"; sleep 10
  screencapture -x "$out/dmg-window.png"
  osascript -e 'tell application "Finder" to close every window' >> "$out/osascript.txt" 2>&1
  # Finder shows the mounted volume's icon on the desktop.
  defaults write com.apple.finder ShowExternalHardDrivesOnDesktop -bool true
  defaults write com.apple.finder ShowRemovableMediaOnDesktop -bool true
  killall Finder; sleep 8
  screencapture -x "$out/desktop-volume.png"
  hdiutil detach "$vol" -force
fi
echo "$label" > "$out/label.txt"
exit 0
