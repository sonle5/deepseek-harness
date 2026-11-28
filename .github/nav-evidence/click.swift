// Click once at the given screen point with hardware-like CGEvents.
import CoreGraphics
import Foundation

let x = Double(CommandLine.arguments[1])!, y = Double(CommandLine.arguments[2])!
let point = CGPoint(x: x, y: y)
for type in [CGEventType.mouseMoved, .leftMouseDown, .leftMouseUp] {
  CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: .left)!.post(tap: .cghidEventTap)
  usleep(150_000)
}
