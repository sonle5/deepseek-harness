// Press and release ⇧⌘J as hardware-like CGEvents, including the modifier flag changes.
import CoreGraphics
import Foundation

let source = CGEventSource(stateID: .hidSystemState)
func post(_ key: CGKeyCode, down: Bool, flags: CGEventFlags) {
  let event = CGEvent(keyboardEventSource: source, virtualKey: key, keyDown: down)!
  event.flags = flags
  event.post(tap: .cghidEventTap)
  usleep(150_000)
}
let command: CGKeyCode = 55, shift: CGKeyCode = 56, j: CGKeyCode = 38
post(command, down: true, flags: .maskCommand)
post(shift, down: true, flags: [.maskCommand, .maskShift])
post(j, down: true, flags: [.maskCommand, .maskShift])
post(j, down: false, flags: [.maskCommand, .maskShift])
post(shift, down: false, flags: .maskCommand)
post(command, down: false, flags: [])
