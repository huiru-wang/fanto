import SwiftUI

enum AppTab: Hashable {
    case records
    case fanto
    case userCenter
}

struct AppRootView: View {
    @State private var userProfile = UserProfileStore()
    @State private var fantoProfile = FantoSettingsStore()
    @State private var selection: AppTab = .fanto
    @State private var conversationStore: ConversationStore

    init(conversationStore: ConversationStore) {
        _conversationStore = State(initialValue: conversationStore)
    }

    var body: some View {
        TabView(selection: $selection) {
            Tab("记录", systemImage: "rectangle.stack", value: .records) {
                RecordsView()
            }
            Tab("Fanto", systemImage: "message", value: .fanto) {
                FantoConversationView(store: conversationStore)
            }
            Tab("我的", systemImage: "person.crop.circle", value: .userCenter) {
                UserCenterView(profile: userProfile)
            }
        }
        .environment(\.userProfile, userProfile)
        .environment(\.fantoProfile, fantoProfile)
        .task { await fantoProfile.load() }
        .task { await userProfile.load() }
        .tint(FantoTheme.accent)
        .task {
            await conversationStore.load()
        }
    }
}

#Preview {
    AppRootView(conversationStore: ConversationStore())
        .environment(FantoStore.preview)
}
