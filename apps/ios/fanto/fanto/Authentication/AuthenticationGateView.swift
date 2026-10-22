import SwiftUI

struct AuthenticationGateView: View {
    @Environment(FantoStore.self) private var fantoStore
    @State private var auth = AuthenticationStore.shared
    @State private var conversationStore = ConversationStore()
    @State private var preparedUserID: String?
    @State private var userProfile: UserProfileStore?
    @State private var fantoProfile: FantoSettingsStore?

    var body: some View {
        Group {
            if case .signedOut = auth.state {
                AuthenticationEntryView(auth: auth)
            } else if case let .signedIn(user) = auth.state,
                      preparedUserID == user.userId, let userProfile, let fantoProfile {
                AppRootView(conversationStore: conversationStore, userProfile: userProfile, fantoProfile: fantoProfile)
                    .id(user.userId)
            } else if case .restoring = auth.state, auth.error == .network {
                ZStack {
                    StartupExperienceView()
                    VStack { Spacer(); Text("网络连接失败，登录状态尚未验证"); Button("重试") { Task { await auth.restore() } }; Spacer().frame(height: 64) }
                }
            } else {
                // Keep the same view identity through authentication and local restoration.
                StartupExperienceView()
            }
        }
        .task { await auth.restore() }
        .task(id: signedInUserID) {
            guard case let .signedIn(user) = auth.state, preparedUserID != user.userId else { return }
            await prepareApp(for: user)
        }
        .onReceive(NotificationCenter.default.publisher(for: .fantoAuthSessionInvalidated)) { _ in
            fantoStore.resetUserData()
            auth.invalidateSession()
        }
        .onChange(of: auth.state) { oldValue, newValue in
            if case .signedIn = oldValue, case .signedOut = newValue {
                fantoStore.resetUserData()
                conversationStore.reset()
                preparedUserID = nil
                userProfile = nil
                fantoProfile = nil
            }
        }
    }

    private var signedInUserID: String? {
        guard case let .signedIn(user) = auth.state else { return nil }
        return user.userId
    }

    private func prepareApp(for user: AuthUser) async {
        await AccountCache.shared.activate(for: user.userId)
        guard !Task.isCancelled, case let .signedIn(current) = auth.state, current.userId == user.userId else { return }
        let cacheScope = AccountCache.shared.scope
        let userProfile = UserProfileStore(), fantoProfile = FantoSettingsStore()
        await userProfile.restore()
        await fantoProfile.restore()
        // Warm only existing local files. Startup never waits for avatar downloads.
        if let id = userProfile.profile?.avatarMediaId { await MediaImageCache.shared.restore(id: id, variant: .thumbnail) }
        if let id = userProfile.profile?.coverMediaId { await MediaImageCache.shared.restore(id: id, variant: .original) }
        if let id = fantoProfile.settings?.avatarMediaId { await MediaImageCache.shared.restore(id: id, variant: .thumbnail) }
        guard isPreparing(user.userId, scope: cacheScope) else { return }
        await fantoStore.restoreRecordSnapshot(for: user.userId)
        guard isPreparing(user.userId, scope: cacheScope) else { return }
        self.userProfile = userProfile
        self.fantoProfile = fantoProfile
        preparedUserID = user.userId
    }

    private func isPreparing(_ userID: String, scope: AccountCacheScope?) -> Bool {
        guard !Task.isCancelled, AccountCache.shared.scope == scope,
              case let .signedIn(user) = auth.state else { return false }
        return user.userId == userID
    }
}
