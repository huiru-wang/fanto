import SwiftUI

struct ProposalSwipeFeedbackView: View {
    let horizontalTranslation: CGFloat
    let threshold: CGFloat

    var body: some View {
        Label(title, systemImage: symbol)
            .font(.headline)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .foregroundStyle(tint)
            .background(.regularMaterial, in: .capsule)
            .opacity(progress)
            .scaleEffect(0.96 + (0.04 * progress))
            .accessibilityHidden(true)
    }

    private var progress: CGFloat {
        min(abs(horizontalTranslation) / threshold, 1)
    }

    private var title: String {
        horizontalTranslation >= 0 ? "长期跟踪" : "暂不保留"
    }

    private var symbol: String {
        horizontalTranslation >= 0 ? "checkmark" : "xmark"
    }

    private var tint: Color {
        horizontalTranslation >= 0 ? FantoTheme.accent : .red
    }
}
