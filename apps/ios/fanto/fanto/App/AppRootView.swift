import SwiftUI

enum AppTab: Hashable {
    case records
    case fanto
    case userCenter
}

struct AppRootView: View {
    @Environment(FantoStore.self) private var fantoStore
    @State private var userProfile: UserProfileStore
    @State private var fantoProfile: FantoSettingsStore
    @State private var selection: AppTab = .records
    @State private var conversationStore: ConversationStore

    init(conversationStore: ConversationStore, userProfile: UserProfileStore? = nil, fantoProfile: FantoSettingsStore? = nil) {
        _conversationStore = State(initialValue: conversationStore)
        _userProfile = State(initialValue: userProfile ?? UserProfileStore())
        _fantoProfile = State(initialValue: fantoProfile ?? FantoSettingsStore())
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
        .environment(\.defaultMinListRowHeight, 44)
        .task { await fantoStore.loadRecords() }
        .task { await fantoProfile.load() }
        .task { await userProfile.load() }
        .task { await userProfile.loadAccount() }
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
