import SwiftUI

struct UserAccountView: View {
    @Environment(\.userProfile) private var profile
    private var account: AccountInfo? { profile?.account }
    @State private var error: String?
    private var isLoading: Bool { profile?.isLoadingAccount ?? false }
    @State private var confirmingSignOut = false
    @State private var isSigningOut = false
    var body: some View {
        List {
            if let account {
                Section("登录方式") {
                    ForEach(account.identities) { identity in
                        LabeledContent(identity.title, value: identity.displayHint ?? "已绑定")
                    }
                }
            } else if isLoading { ProgressView("正在读取账号") }
            if let error = error ?? profile?.accountError {
                Section {
                    Text(error).foregroundStyle(.secondary)
                    Button("重新读取") { Task { await load(force: true) } }.disabled(isLoading)
                }
            }
            Section {
                Button("退出登录", role: .destructive) { confirmingSignOut = true }.disabled(isSigningOut)
            } footer: { Text("退出会清除本机登录凭据和当前账号的本地记录缓存，不删除服务端资料。") }
            Section {
                PendingSettingsLink(title: "注销账号", symbol: "person.crop.circle.badge.xmark", destructive: true)
            }
        }
        .navigationTitle("账号与登录").navigationBarTitleDisplayMode(.inline)
        .alert("退出当前账号？", isPresented: $confirmingSignOut) {
            Button("退出登录", role: .destructive) {
                Task {
                    isSigningOut = true
                    do { try await AuthenticationStore.shared.signOut() }
                    catch { self.error = error.localizedDescription }
                    isSigningOut = false
                }
            }
            Button("取消", role: .cancel) { }
        } message: {
            Text("退出会清除本机登录凭据和当前账号缓存，服务端资料会保留。")
        }
        .task { await load() }
    }
    private func load(force: Bool = false) async {
        await profile?.loadAccount(force: force)
    }
}

struct UserPrivacyView: View {
    var body: some View {
        List {
            Section {
                PendingSettingsLink(title: "存储与缓存", symbol: "internaldrive")
                PendingSettingsLink(title: "导出我的数据", symbol: "square.and.arrow.up")
            }
            Section {
                PendingSettingsLink(title: "数据处理与授权", symbol: "lock.shield")
            }
        }
        .navigationTitle("数据与隐私").navigationBarTitleDisplayMode(.inline)
    }
}

struct UserHelpFeedbackView: View {
    var body: some View {
        List {
            Section {
                Link(destination: FantoWebsite.help) {
                    HStack { Text("使用帮助"); Spacer(); Image(systemName: "arrow.up.right").foregroundStyle(.secondary) }
                }
            }
            Section {
                PendingSettingsLink(title: "问题反馈", symbol: "bubble.left.and.bubble.right")
                PendingSettingsLink(title: "联系支持", symbol: "envelope")
            }
        }
        .navigationTitle("帮助与反馈").navigationBarTitleDisplayMode(.inline)
    }
}

struct UserAboutView: View {
    var body: some View {
        List {
            Section {
                NavigationLink("关于 Fanto") { FantoAboutDetailView() }
            }
            Section {
                Link(destination: FantoWebsite.terms) {
                    HStack { Text("使用条款"); Spacer(); Image(systemName: "arrow.up.right").foregroundStyle(.secondary) }
                }
                Link(destination: FantoWebsite.privacy) {
                    HStack { Text("隐私政策"); Spacer(); Image(systemName: "arrow.up.right").foregroundStyle(.secondary) }
                }
            }
        }
        .navigationTitle("关于").navigationBarTitleDisplayMode(.inline)
    }
}

/// Reserved landing-page routes; website content will be published separately.
private enum FantoWebsite {
    static let help = URL(string: "https://fanto.robinverse.me/help")!
    static let terms = URL(string: "https://fanto.robinverse.me/terms")!
    static let privacy = URL(string: "https://fanto.robinverse.me/privacy")!
}

private struct FantoAboutDetailView: View {
    private var version: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—" }
    var body: some View {
        List {
            Section {
                Text("Fanto").font(.title2.bold())
            }
            Section {
                LabeledContent("版本号", value: version)
            }
        }
        .navigationTitle("关于 Fanto").navigationBarTitleDisplayMode(.inline)
    }
}
