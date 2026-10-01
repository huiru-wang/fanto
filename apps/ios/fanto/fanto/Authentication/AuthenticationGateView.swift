import SwiftUI

struct AuthenticationGateView: View {
    @Environment(FantoStore.self) private var fantoStore
    @State private var auth = AuthenticationStore.shared
    @State private var conversationStore = ConversationStore()
    @State private var taskDetailCache = TaskDetailCache()
    @State private var preparedUserID: String?

    var body: some View {
        Group {
            switch auth.state {
            case .restoring:
                restoringView
            case .signedOut:
                AuthenticationEntryView(auth: auth)
            case let .signedIn(user):
                if preparedUserID == user.userId {
                    AppRootView(conversationStore: conversationStore, taskDetailCache: taskDetailCache)
                } else {
                    StartupExperienceView()
                        .task(id: user.userId) {
                            await prepareApp(for: user)
                        }
                }
            }
        }
        .task { await auth.restore() }
        .onReceive(NotificationCenter.default.publisher(for: .fantoAuthSessionInvalidated)) { _ in
            fantoStore.resetUserData()
            auth.invalidateSession()
        }
        .onChange(of: auth.state) { oldValue, newValue in
            if case .signedIn = oldValue, case .signedOut = newValue {
                fantoStore.resetUserData()
                conversationStore.reset()
                taskDetailCache.reset()
                preparedUserID = nil
            }
        }
    }

    private var restoringView: some View {
        StartupExperienceView()
    }

    private func prepareApp(for user: AuthUser) async {
        await fantoStore.restoreRecordSnapshot(for: user.userId)
        async let records: Void = fantoStore.loadRecords()
        async let projects: Void = fantoStore.loadProjects()
        async let conversation: Void = conversationStore.load()
        _ = await (records, projects, conversation)

        guard case let .signedIn(currentUser) = auth.state, currentUser.userId == user.userId else {
            return
        }
        preparedUserID = user.userId
    }
}
