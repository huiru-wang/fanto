import GoogleSignInSwift
import SwiftUI

struct AuthenticationEntryView: View {
    @Bindable var auth: AuthenticationStore
    @State private var path: [AuthenticationMode] = []

    var body: some View {
        NavigationStack(path: $path) {
            WelcomeView(
                createAccount: { open(.register) },
                signIn: { open(.signIn) }
            )
            .navigationDestination(for: AuthenticationMode.self) { mode in
                GoogleAuthenticationView(mode: mode, auth: auth, chooseMode: replace)
            }
        }
    }

    private func open(_ mode: AuthenticationMode) {
        auth.clearError()
        path.append(mode)
    }

    private func replace(with mode: AuthenticationMode) {
        auth.clearError()
        path = [mode]
    }
}

private struct WelcomeView: View {
    let createAccount: () -> Void
    let signIn: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 48)

            VStack(spacing: 18) {
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .fill(FantoTheme.softAccent)
                    .frame(width: 82, height: 82)
                    .overlay {
                        Image(systemName: "sparkles")
                            .font(.title.weight(.medium))
                            .foregroundStyle(FantoTheme.accent)
                    }
                    .accessibilityHidden(true)

                Text("把生活线索留给自己")
                    .font(.largeTitle.bold())
                    .multilineTextAlignment(.center)

                Text("用 Fanto 记录当下，慢慢看见属于你的脉络。")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(3)
            }

            Spacer(minLength: 42)

            VStack(spacing: 14) {
                Button("创建 Fanto 账号", action: createAccount)
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .frame(maxWidth: .infinity)

                Button("已有账号？登录", action: signIn)
                    .font(.body.weight(.semibold))
            }
        }
        .padding(.horizontal, 28)
        .padding(.bottom, 24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
    }
}

private struct GoogleAuthenticationView: View {
    let mode: AuthenticationMode
    @Bindable var auth: AuthenticationStore
    let chooseMode: (AuthenticationMode) -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: 28) {
                VStack(spacing: 10) {
                    Text(mode.heading)
                        .font(.largeTitle.bold())
                        .multilineTextAlignment(.center)
                    Text(mode.detail)
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .lineSpacing(3)
                }
                .padding(.top, 48)

                VStack(spacing: 18) {
                    googleButton

                    if let error = auth.error {
                        errorView(error)
                    }

                    Text("Fanto 只使用 Google 返回的已验证身份来建立账号，不会获得你的 Google 密码。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)

                    if mode == .register {
                        Text("继续即表示你同意 Fanto 的服务条款与隐私政策。")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                            .multilineTextAlignment(.center)
                    } else {
                        Button("还没有账号？创建账号") {
                            chooseMode(.register)
                        }
                        .font(.footnote.weight(.semibold))
                    }
                }
            }
            .padding(.horizontal, 28)
            .padding(.bottom, 24)
            .frame(maxWidth: .infinity)
        }
        .navigationTitle(mode.navigationTitle)
        .navigationBarTitleDisplayMode(.inline)
    }

    private var googleButton: some View {
        GoogleSignInButton {
            Task { await auth.authenticate(mode: mode) }
        }
        .frame(maxWidth: .infinity)
        .frame(height: 50)
        .disabled(auth.isSubmitting)
        .opacity(auth.isSubmitting ? 0.65 : 1)
        .overlay {
            if auth.isSubmitting {
                RoundedRectangle(cornerRadius: 4)
                    .fill(.background.opacity(0.82))
                ProgressView()
            }
        }
        .accessibilityLabel(mode.googleTitle)
    }

    @ViewBuilder
    private func errorView(_ error: AuthenticationError) -> some View {
        VStack(spacing: 8) {
            Label(error.localizedDescription, systemImage: "exclamationmark.circle")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)

            if error == .notRegistered {
                Button("创建账号") { chooseMode(.register) }
                    .font(.footnote.weight(.semibold))
            } else if error == .alreadyRegistered {
                Button("直接登录") { chooseMode(.signIn) }
                    .font(.footnote.weight(.semibold))
            }
        }
        .frame(maxWidth: .infinity)
    }
}
