import SwiftUI

struct StartupExperienceView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var hasAppeared = false

    var body: some View {
        ZStack {
            LoginBackground()

            VStack(spacing: 20) {
                Image("FantoStartupSprite")
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: 210)
                    .accessibilityLabel("Fanto 精灵")

                Text("Pieces become something.")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(.primary)
                    .multilineTextAlignment(.center)
            }
            .padding(.horizontal, 32)
            .opacity(hasAppeared || reduceMotion ? 1 : 0)
            .scaleEffect(hasAppeared || reduceMotion ? 1 : 0.96)
        }
        .task {
            guard !reduceMotion else {
                hasAppeared = true
                return
            }
            withAnimation(.easeOut(duration: 0.34)) {
                hasAppeared = true
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Fanto，Pieces become something。正在准备内容")
    }
}

#Preview {
    StartupExperienceView()
}
