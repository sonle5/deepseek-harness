on run argv
  set procName to item 1 of argv
  set menuName to item 2 of argv
  set output to ""
  tell application "System Events" to tell process procName
    set theItems to every menu item of menu 1 of menu bar item menuName of menu bar 1
    repeat with anItem in theItems
      set itemName to name of anItem
      if itemName is missing value then
        set output to output & "----" & linefeed
      else
        set keyChar to ""
        set keyMods to ""
        try
          set keyChar to value of attribute "AXMenuItemCmdChar" of anItem
          set keyMods to value of attribute "AXMenuItemCmdModifiers" of anItem
        end try
        if keyChar is missing value then set keyChar to ""
        set subNames to ""
        try
          set subNames to name of every menu item of menu 1 of anItem
          set AppleScript's text item delimiters to " | "
          set subNames to " submenu=[" & (subNames as text) & "]"
          set AppleScript's text item delimiters to ""
        end try
        set output to output & itemName & tab & "enabled=" & (enabled of anItem as text) & tab & "key=" & keyChar & tab & "modifiers=" & (keyMods as text) & subNames & linefeed
      end if
    end repeat
  end tell
  return output
end run
