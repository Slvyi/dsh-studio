// 生成 dsh-desktop 图标:assets/icon.png(128px) + assets/tray-icon.png(模板 22px)。
// 用法:swift scripts/make-icons.swift
import AppKit
import Foundation

let outDir = URL(fileURLWithPath: "assets", isDirectory: true)
try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)

func drawIcon(size: CGFloat, rounded: CGFloat, background: NSColor, accent: NSColor, symbol: (CGFloat) -> Void) -> Data {
    let image = NSImage(size: NSSize(width: size, height: size))
    image.lockFocus()
    let rect = NSRect(x: 0, y: 0, width: size, height: size)
    background.setFill()
    NSBezierPath(roundedRect: rect, xRadius: rounded, yRadius: rounded).fill()
    symbol(size)
    image.unlockFocus()
    guard let tiff = image.tiffRepresentation,
          let rep = NSBitmapImageRep(data: tiff),
          let png = rep.representation(using: .png, properties: [:]) else {
        fatalError("icon render failed")
    }
    return png
}

// 应用图标:深蓝圆角 + 白色对角切出的 "D" 形态。
let appPng = drawIcon(size: 128, rounded: 28, background: NSColor(calibratedRed: 0.10, green: 0.30, blue: 0.98, alpha: 1), accent: .white) { s in
    let d = s * 0.34
    let stroke: CGFloat = s * 0.10
    let path = NSBezierPath()
    path.move(to: NSPoint(x: d, y: s - d))
    path.line(to: NSPoint(x: d, y: d))
    path.line(to: NSPoint(x: s * 0.58, y: d))
    path.appendArc(withCenter: NSPoint(x: s * 0.58, y: s * 0.5), radius: s * 0.24, startAngle: 270, endAngle: 90, clockwise: false)
    path.line(to: NSPoint(x: s * 0.58, y: s - d))
    path.close()
    NSColor.white.setFill()
    path.fill()
}
try appPng.write(to: outDir.appendingPathComponent("icon.png"))

// 托盘图标:模板风格,白色圆点 + 缺口,menu bar 自动适配深色/浅色。
let trayPng = drawIcon(size: 22, rounded: 0, background: .clear, accent: .white) { s in
    let ring = NSBezierPath(ovalIn: NSRect(x: s * 0.18, y: s * 0.18, width: s * 0.64, height: s * 0.64))
    ring.lineWidth = s * 0.09
    NSColor.white.setStroke()
    ring.stroke()
    let dot = NSBezierPath(ovalIn: NSRect(x: s * 0.42, y: s * 0.42, width: s * 0.16, height: s * 0.16))
    NSColor.white.setFill()
    dot.fill()
}
try trayPng.write(to: outDir.appendingPathComponent("tray-icon.png"))
print("icons written to assets/")
