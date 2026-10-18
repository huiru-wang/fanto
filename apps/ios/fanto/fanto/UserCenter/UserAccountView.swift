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
                PendingSettingsLink(title: "AI 数据处理与授权", symbol: "lock.shield")
            }
        }
        .navigationTitle("数据与隐私").navigationBarTitleDisplayMode(.inline)
    }
}

struct UserHelpFeedbackView: View {
    var body: some View {
        List {
            Section {
                NavigationLink("使用帮助") { UserHelpView() }
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
                PendingSettingsLink(title: "使用条款", symbol: "doc.text", status: "待发布")
                PendingSettingsLink(title: "隐私政策", symbol: "hand.raised", status: "待发布")
                PendingSettingsLink(title: "开源许可", symbol: "list.bullet.rectangle", status: "待完善")
            }
        }
        .navigationTitle("关于").navigationBarTitleDisplayMode(.inline)
    }
}

private struct UserHelpView: View {
    var body: some View {
        List {
            Section("Fanto") {
                Text("在对话页点击左上角头像，修改昵称与角色设定。每项内容在自己的编辑页保存。")
            }
            Section("我的") {
                Text("点击昵称进入个人信息，修改头像、背景图、昵称与签名。")
                Text("在偏好中选择外观和强调色，选择后立即生效。")
            }
        }
        .navigationTitle("使用帮助").navigationBarTitleDisplayMode(.inline)
    }
}

private struct FantoAboutDetailView: View {
    private var version: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—" }
    private var build: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "—" }
    var body: some View {
        List {
            Section {
                Text("Fanto").font(.title2.bold())
            }
            Section {
                LabeledContent("版本号", value: version)
                LabeledContent("构建号", value: build)
            }
        }
        .navigationTitle("关于 Fanto").navigationBarTitleDisplayMode(.inline)
    }
}
