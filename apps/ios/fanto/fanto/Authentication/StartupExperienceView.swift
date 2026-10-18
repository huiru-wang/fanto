import SwiftUI

struct StartupExperienceView: View {
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
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Fanto，Pieces become something。正在准备内容")
    }
}

#Preview {
    StartupExperienceView()
}
