import SwiftUI

struct AuthenticationEntryView: View {
    @Bindable var auth: AuthenticationStore

    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                VStack(spacing: 0) {
                    Spacer(minLength: max(48, geometry.size.height * 0.17))

                    Image("FantoLoginSprite")
                        .resizable()
                        .scaledToFit()
                        .frame(width: min(156, geometry.size.width * 0.36))
                        .accessibilityLabel("Fanto 精灵")

                    Text("Pieces become something.")
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(.primary)
                        .multilineTextAlignment(.center)
                        .padding(.top, 22)

                    Spacer(minLength: max(94, geometry.size.height * 0.19))

                    AuthenticationProviderButton(
                        title: "通过 Google 继续",
                        assetIcon: "GoogleG",
                        action: authenticateWithGoogle
                    )
                    .disabled(auth.isSubmitting)
                    .overlay {
                        if auth.isSubmitting {
                            RoundedRectangle(cornerRadius: 26, style: .continuous)
                                .fill(.background.opacity(0.74))
                            ProgressView()
                                .accessibilityLabel("正在通过 Google 登录")
                        }
                    }

                    AuthenticationProviderButton(
                        title: "通过 Apple 继续",
                        systemIcon: "apple.logo",
                        availability: "即将支持",
                        isEnabled: false,
                        action: {}
                    )
                    .padding(.top, 12)
                    .accessibilityHint("Apple 登录即将支持")

                    if let error = auth.error {
                        Label(error.localizedDescription, systemImage: "exclamationmark.circle")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                            .padding(.top, 18)
                    }

                    Spacer(minLength: 40)

                    Text("继续即表示你同意 Fanto 的服务条款与隐私政策。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.bottom, 28)
                }
                .frame(minHeight: geometry.size.height, alignment: .top)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 20)
            }
            .scrollIndicators(.hidden)
            .background(LoginBackground())
        }
    }

    private func authenticateWithGoogle() {
        Task {
            await auth.authenticateWithGoogle()
        }
    }
}
