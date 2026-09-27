import SwiftUI

struct LoginBackground: View {
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        LinearGradient(
            colors: colorScheme == .dark
                ? [Color(red: 0.12, green: 0.16, blue: 0.23), Color(red: 0.18, green: 0.16, blue: 0.14)]
                : [Color(red: 0.82, green: 0.91, blue: 0.99), Color(red: 1.0, green: 0.97, blue: 0.90)],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }
}
