import SwiftUI
import Observation

@MainActor @Observable
private final class UserCenterScrollState {
    var offset: CGFloat = 0
    var photoVisible = true
    func update(_ offset: CGFloat) {
        self.offset = max(0, offset)
        photoVisible = offset < 180
    }
}

struct UserCenterView: View {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Bindable var profile: UserProfileStore
    @State private var appearance = AppAppearance.shared
    @State private var scroll = UserCenterScrollState()
    var body: some View {
        NavigationStack {
            ZStack {
                Color(uiColor: .systemGroupedBackground).ignoresSafeArea()
                UserCenterBackdrop(mediaID: profile.profile?.coverMediaId, scroll: scroll)
                List {
                    Section {
                        header.listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
                    }
                    Section {
                        HStack {
                            settingsLabel("外观", icon: "circle.lefthalf.filled")
                            Spacer()
                            Menu {
                                Picker("外观", selection: $appearance.mode) {
                                    ForEach(AppAppearance.Mode.allCases) { Text($0.title).tag($0) }
                                }
                            } label: {
                                HStack(spacing: 6) {
                                    Text(appearance.mode.summary)
                                    Image(systemName: "chevron.up.chevron.down").font(.caption)
                                }
                                .foregroundStyle(.secondary)
                            }
                            .buttonStyle(.plain)
                            .tint(FantoTheme.accent)
                            .accessibilityLabel("外观")
                            .accessibilityValue(appearance.mode.summary)
                        }
                        HStack {
                            settingsLabel("强调色", icon: "paintbrush")
                            Spacer()
                            Menu {
                                Picker("强调色", selection: $appearance.accent) {
                                    ForEach(AppAppearance.Accent.allCases) { accent in
                                        Label { Text(accent.title) } icon: {
                                            Image(uiImage: accent.menuSwatch).renderingMode(.original)
                                        }.tag(accent)
                                    }
                                }
                            } label: {
                                HStack(spacing: 6) {
                                    Image(uiImage: appearance.accent.menuSwatch).renderingMode(.original)
                                    Text(appearance.accent.title)
                                    Image(systemName: "chevron.up.chevron.down").font(.caption)
                                }
                                .foregroundStyle(.secondary)
                            }
                            .buttonStyle(.plain)
                            .tint(FantoTheme.accent)
                            .accessibilityLabel("强调色")
                            .accessibilityValue(appearance.accent.title)
                        }
                    }
                    Section {
                        NavigationLink { UserAccountView() } label: { settingsLabel("账号与登录", icon: "person.crop.circle") }
                        NavigationLink { UserPrivacyView() } label: { settingsLabel("数据与隐私", icon: "lock.shield") }
                    }
                    Section {
                        NavigationLink { UserHelpFeedbackView() } label: { settingsLabel("帮助与反馈", icon: "questionmark.circle") }
                        NavigationLink { UserAboutView() } label: { settingsLabel("关于", icon: "info.circle") }
                    }
                    if let error = profile.error ?? profile.statisticsError {
                        Section {
                            Text(error).foregroundStyle(.secondary)
                            Button("重新读取资料") { Task { await reload() } }
                        }
                    }
                }
                .listStyle(.insetGrouped)
                .scrollContentBackground(.hidden)
                .contentMargins(.top, 0, for: .scrollContent)
                .onScrollGeometryChange(for: CGFloat.self) { $0.contentOffset.y + $0.contentInsets.top } action: { _, value in scroll.update(value) }
                .refreshable { await reload() }
            }
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(scroll.photoVisible && !reduceTransparency ? .hidden : .automatic, for: .navigationBar)
            .toolbarColorScheme(scroll.photoVisible && !reduceTransparency ? .dark : nil, for: .navigationBar)
            .task { await profile.load() }
        }
        .tint(.primary)
    }
    private func settingsLabel(_ title: String, icon: String) -> some View {
        Label { Text(title) } icon: {
            Image(systemName: icon).foregroundStyle(.primary)
        }
    }

    private func reload() async {
        async let details: Void = profile.load(force: true)
        async let statistics: Void = profile.loadStatistics(force: true)
        _ = await (details, statistics)
    }

    private func statistic(_ title: String, value: Int?, placeholder: Bool = false) -> some View {
        VStack(spacing: 6) {
            Text(value.map { String($0) } ?? "—")
                .font(.title2.weight(.semibold)).monospacedDigit()
                .lineLimit(1).minimumScaleFactor(0.7)
            Text(title).font(.subheadline).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(title)，\(value.map { String($0) } ?? "暂未读取")\(placeholder ? "，示例值" : "")")
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let value = profile.profile {
                NavigationLink { UserProfileEditView(profile: profile) } label: {
                    HStack(spacing: 16) {
                        UserAvatar(mediaID: value.avatarMediaId, size: 76)
                        VStack(alignment: .leading, spacing: 6) {
                            Text(value.nickname).font(.title2.bold()).foregroundStyle(.primary)
                            Text(value.signature.isEmpty ? "添加一句话签名" : value.signature)
                                .font(.subheadline).foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 0)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(value.nickname)，修改个人信息")
                HStack(alignment: .top, spacing: 12) {
                    statistic("相伴天数", value: profile.statistics?.companionDays)
                    statistic("记录数", value: profile.statistics?.recordCount)
                    statistic("亲密度", value: profile.statistics?.intimacy,
                              placeholder: profile.statistics?.intimacyIsPlaceholder ?? false)
                }
                .padding(.top, 8)
            } else if profile.isLoading { ProgressView("正在读取资料").frame(maxWidth: .infinity) }
        }
        .padding(.horizontal, 16).padding(.top, 172).padding(.bottom, 12)
    }
}

private struct UserCenterBackdrop: View {
    let mediaID: String?
    let scroll: UserCenterScrollState
    var body: some View {
        GeometryReader { geometry in
            UserCover(mediaID: mediaID)
                .frame(width: geometry.size.width, height: 380)
                .clipped()
                .overlay(alignment: .top) {
                    LinearGradient(colors: [.black.opacity(0.35), .clear], startPoint: .top, endPoint: .bottom).frame(height: 110)
                }
                .overlay(alignment: .bottom) {
                    LinearGradient(colors: [.clear, Color(uiColor: .systemGroupedBackground)], startPoint: .top, endPoint: .bottom).frame(height: 170)
                }
                .offset(y: -scroll.offset)
        }
        .ignoresSafeArea(edges: .top).allowsHitTesting(false).accessibilityHidden(true)
    }
}
