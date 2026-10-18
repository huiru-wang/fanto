import SwiftUI

struct UserAccountView: View {
    @State private var account: AccountInfo?
    @State private var error: String?
    @State private var isLoading = false
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
            if let error {
                Section {
                    Text(error).foregroundStyle(.secondary)
                    Button("重新读取") { Task { await load() } }.disabled(isLoading)
                }
            }
            Section {
                Button("退出登录", role: .destructive) { confirmingSignOut = true }.disabled(isSigningOut)
            } footer: { Text("退出会清除本机登录凭据和当前账号的本地记录缓存，不删除服务端资料。") }
        }
        .navigationTitle("账号与登录").navigationBarTitleDisplayMode(.inline)
        .confirmationDialog("退出当前账号？", isPresented: $confirmingSignOut, titleVisibility: .visible) {
            Button("退出登录", role: .destructive) {
                Task {
                    isSigningOut = true
                    do { try await AuthenticationStore.shared.signOut() }
                    catch { self.error = error.localizedDescription }
                    isSigningOut = false
                }
            }
            Button("取消", role: .cancel) { }
        }
        .task { await load() }
    }
    private func load() async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        do { let value = try await FantoAPIClient.shared.fetchAccountInfo(); try Task.checkCancellation(); account = value; error = nil }
        catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }
}

struct UserPrivacyView: View {
    var body: some View {
        List {
            Section("个人资料") { Text("头像、昵称与签名保存在当前账号下，用于展示你的个人信息，与 Fanto 的角色设定分开管理。") }
            Section("头像") { Text("头像仅上传你确认裁切后的图片，不上传原图。") }
            Section("记录与对话") { Text("记录和对话按账号隔离。你可以在记录页长按删除记录；删除记录不等于删除此前形成的记忆或对话。") }
            Section("本机偏好") { Text("外观与强调色仅保存在这台设备，切换账号后继续使用当前设备的选择。") }
        }
        .navigationTitle("数据与隐私").navigationBarTitleDisplayMode(.inline)
    }
}
struct UserAboutView: View {
    private var version: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—" }
    var body: some View {
        List {
            Section {
                LabeledContent("Fanto", value: version)
                Text("角色有延续，相处有记忆。")
            }
            Section("开始相处") {
                Text("在 Fanto 页开始对话，点击左上角 Fanto 头像设定角色、场景与交流规则。")
                Text("在“我的”点击昵称修改个人资料，在“偏好”直接选择外观与强调色。")
            }
        }
        .navigationTitle("帮助与关于").navigationBarTitleDisplayMode(.inline)
    }
}
