import SwiftUI
import Observation

@MainActor @Observable
final class AppAppearance {
    static let shared = AppAppearance()
    var mode: Mode { didSet { UserDefaults.standard.set(mode.rawValue, forKey: "appearance.mode") } }
    var accent: Accent { didSet { UserDefaults.standard.set(accent.rawValue, forKey: "appearance.accent") } }
    private init() {
        mode = Mode(rawValue: UserDefaults.standard.string(forKey: "appearance.mode") ?? "") ?? .system
        accent = Accent(rawValue: UserDefaults.standard.string(forKey: "appearance.accent") ?? "") ?? .blue
    }
    enum Mode: String, CaseIterable, Identifiable {
        case system, light, dark
        var id: Self { self }
        var title: String { switch self { case .system: "系统（默认）"; case .light: "浅色"; case .dark: "深色" } }
        var summary: String { self == .system ? "跟随系统" : title }
        var scheme: ColorScheme? { switch self { case .system: nil; case .light: .light; case .dark: .dark } }
    }
    enum Accent: String, CaseIterable, Identifiable {
        case blue, cyan, green, lime, yellow, orange, pink, magenta, purple, black
        var id: Self { self }
        var title: String { switch self { case .blue: "蓝色"; case .cyan: "青色"; case .green: "绿色"; case .lime: "青柠绿"; case .yellow: "黄色"; case .orange: "橙色"; case .pink: "粉色"; case .magenta: "洋红色"; case .purple: "紫色"; case .black: "黑色" } }
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
                case .black: return .label
                }
            })
        }
        var swatch: Color { switch self { case .cyan: .cyan; case .green: .mint; case .lime: Color(red: 0.65, green: 0.82, blue: 0.05); case .yellow: .yellow; case .orange: .orange; case .pink: .pink; case .magenta: Color(red: 0.83, green: 0.23, blue: 0.80); default: color } }
    }
}
