on run argv
  set procName to item 1 of argv
  set buttonName to item 2 of argv
  tell application "System Events" to tell process procName
    set candidates to every UI element of (entire contents of window 1) whose role is "AXButton"
    repeat with candidate in candidates
      set found to false
      try
        if description of candidate is buttonName then set found to true
      end try
      try
        if name of candidate is buttonName then set found to true
      end try
      if found then
        perform action "AXPress" of candidate
        return "pressed " & buttonName
      end if
    end repeat
  end tell
  return "not found: " & buttonName
end run
