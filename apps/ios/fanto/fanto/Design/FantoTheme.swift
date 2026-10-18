import SwiftUI

enum FantoTheme {
    static var accent: Color { AppAppearance.shared.accent.color }
    static var softAccent: Color { accent.opacity(0.14) }
    static let cardRadius: CGFloat = 22
}
