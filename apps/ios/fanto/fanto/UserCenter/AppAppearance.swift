import SwiftUI
import Observation
import UIKit

@MainActor @Observable
final class AppAppearance {
    static let shared = AppAppearance()
    var mode: Mode { didSet { UserDefaults.standard.set(mode.rawValue, forKey: "appearance.mode") } }
    var accent: Accent { didSet { UserDefaults.standard.set(accent.rawValue, forKey: "appearance.accent") } }
    private init() {
        mode = Mode(rawValue: UserDefaults.standard.string(forKey: "appearance.mode") ?? "") ?? .system
        accent = Accent(rawValue: UserDefaults.standard.string(forKey: "appearance.accent") ?? "") ?? .blue
        UserDefaults.standard.set(accent.rawValue, forKey: "appearance.accent")
    }
    enum Mode: String, CaseIterable, Identifiable {
        case system, light, dark
        var id: Self { self }
        var title: String { switch self { case .system: "跟随系统"; case .light: "浅色"; case .dark: "深色" } }
        var summary: String { self == .system ? "跟随系统" : title }
        var scheme: ColorScheme? { switch self { case .system: nil; case .light: .light; case .dark: .dark } }
    }
    enum Accent: String, CaseIterable, Identifiable {
        case blue, cyan, green, lime, yellow, orange, pink, magenta, purple
        var id: Self { self }
        var title: String { switch self { case .blue: "蓝色"; case .cyan: "青色"; case .green: "绿色"; case .lime: "青柠绿"; case .yellow: "黄色"; case .orange: "橙色"; case .pink: "粉色"; case .magenta: "洋红色"; case .purple: "紫色" } }
        var color: Color {
            Color(uiColor: UIColor { traits in
                let dark = traits.userInterfaceStyle == .dark
                switch self {
                case .blue: return .systemBlue
                case .cyan: return dark ? .systemCyan : UIColor(red: 0, green: 0.43, blue: 0.60, alpha: 1)
                case .green: return dark ? .systemMint : UIColor(red: 0, green: 0.45, blue: 0.34, alpha: 1)
                case .lime: return dark ? UIColor(red: 0.70, green: 0.86, blue: 0.20, alpha: 1) : UIColor(red: 0.37, green: 0.48, blue: 0.06, alpha: 1)
                case .yellow: return dark ? .systemYellow : UIColor(red: 0.54, green: 0.40, blue: 0, alpha: 1)
                case .orange: return dark ? .systemOrange : UIColor(red: 0.73, green: 0.31, blue: 0.05, alpha: 1)
                case .pink: return dark ? .systemPink : UIColor(red: 0.79, green: 0.19, blue: 0.42, alpha: 1)
                case .magenta: return dark ? UIColor(red: 0.88, green: 0.35, blue: 0.87, alpha: 1) : UIColor(red: 0.65, green: 0.16, blue: 0.66, alpha: 1)
                case .purple: return .systemPurple
                }
            })
        }
        var swatch: Color { switch self { case .cyan: .cyan; case .green: .mint; case .lime: Color(red: 0.65, green: 0.82, blue: 0.05); case .yellow: .yellow; case .orange: .orange; case .pink: .pink; case .magenta: Color(red: 0.83, green: 0.23, blue: 0.80); default: color } }
        // Menu actions template SF Symbols; render a small original-color swatch instead.
        var menuSwatch: UIImage {
            let color = UIColor(swatch)
            return UIGraphicsImageRenderer(size: CGSize(width: 16, height: 16)).image { context in
                color.setFill()
                context.cgContext.fillEllipse(in: CGRect(x: 1, y: 1, width: 14, height: 14))
                UIColor.separator.setStroke()
                context.cgContext.strokeEllipse(in: CGRect(x: 1, y: 1, width: 14, height: 14))
            }.withRenderingMode(.alwaysOriginal)
        }

    }
}
