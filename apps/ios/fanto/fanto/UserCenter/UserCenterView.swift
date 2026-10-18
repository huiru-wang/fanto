import SwiftUI

struct UserCenterView: View {
    @Bindable var profile: UserProfileStore
    @State private var appearance = AppAppearance.shared
    var body: some View {
        NavigationStack {
            List {
                Section {
                    header
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                }
                Section("偏好") {
                    Menu {
                        Picker("外观", selection: $appearance.mode) {
                            ForEach(AppAppearance.Mode.allCases) { Text($0.title).tag($0) }
                        }
                    } label: {
                        preferenceRow("外观", icon: "circle.lefthalf.filled", value: appearance.mode.summary)
                    }
                    .accessibilityValue(appearance.mode.summary)
                    Menu {
                        Picker("强调色", selection: $appearance.accent) {
                            ForEach(AppAppearance.Accent.allCases) { accent in
                                Label { Text(accent.title) } icon: {
                                    Image(systemName: "circle.fill").symbolRenderingMode(.palette).foregroundStyle(accent.swatch)
                                }.tag(accent)
                            }
                        }
                    } label: {
                        HStack {
                            Label("强调色", systemImage: "paintbrush")
                            Spacer()
                            Circle().fill(appearance.accent.swatch).frame(width: 14, height: 14).accessibilityHidden(true)
                            Text(appearance.accent.title).foregroundStyle(.secondary)
                            Image(systemName: "chevron.up.chevron.down").font(.caption).foregroundStyle(.tertiary)
                        }
                        .foregroundStyle(.primary)
                    }
                    .accessibilityValue(appearance.accent.title)
                }
                Section("账号与数据") {
                    NavigationLink { UserAccountView() } label: { Label("账号与登录", systemImage: "person.crop.circle") }
                    NavigationLink { UserPrivacyView() } label: { Label("数据与隐私", systemImage: "lock.shield") }
                    NavigationLink { UserAboutView() } label: { Label("帮助与关于", systemImage: "info.circle") }
                }
                if let error = profile.error {
                    Section {
                        Text(error).foregroundStyle(.secondary)
                        Button("重新读取资料") { Task { await profile.load() } }
                    }
                }
            }
            .navigationTitle("我的")
            .navigationBarTitleDisplayMode(.inline)
            .listStyle(.insetGrouped)
            .refreshable { await profile.load() }
            .task { if profile.profile == nil { await profile.load() } }
        }
    }
    private var header: some View {
        VStack(alignment: .leading, spacing: 16) {
            Image("UserCenterCover").resizable().scaledToFill()
                .frame(height: 156).clipped()
                .overlay(alignment: .bottom) {
                    LinearGradient(colors: [.clear, Color(uiColor: .systemGroupedBackground)], startPoint: .top, endPoint: .bottom).frame(height: 72)
                }
                .accessibilityHidden(true)
            if let value = profile.profile {
                NavigationLink {
                    UserProfileEditView(profile: profile, value: value)
                } label: {
                    HStack(spacing: 16) {
                        UserAvatar(mediaID: value.avatarMediaId, size: 76)
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text(value.nickname).font(.title2.bold()).foregroundStyle(.primary)
                                Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
                            }
                            Text(value.signature.isEmpty ? "添加一句话签名" : value.signature)
                                .font(.subheadline).foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 0)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(value.nickname)，修改个人信息")
                .padding(.horizontal, 16)
                let days = max(1, (Calendar.current.dateComponents([.day], from: Calendar.current.startOfDay(for: value.joinedAt), to: Calendar.current.startOfDay(for: .now)).day ?? 0) + 1)
                Label("与 Fanto 相伴的第 \(days) 天", systemImage: "sparkles")
                    .font(.footnote).foregroundStyle(.secondary).padding(.horizontal, 16)
            } else if profile.isLoading {
                ProgressView("正在读取资料").frame(maxWidth: .infinity)
            }
        }
        .padding(.bottom, 12)
    }
    private func preferenceRow(_ title: String, icon: String, value: String) -> some View {
        HStack {
            Label(title, systemImage: icon)
            Spacer()
            Text(value).foregroundStyle(.secondary)
            Image(systemName: "chevron.up.chevron.down").font(.caption).foregroundStyle(.tertiary)
        }.foregroundStyle(.primary)
    }
}
