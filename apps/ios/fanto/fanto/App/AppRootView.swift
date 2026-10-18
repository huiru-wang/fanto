import SwiftUI

enum AppTab: Hashable {
    case records
    case fanto
    case projects
}

struct AppRootView: View {
    @State private var fantoProfile = FantoSettingsStore()
    @State private var selection: AppTab = .records
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
            Tab("脉络", systemImage: "point.3.connected.trianglepath.dotted", value: .projects) {
                ProjectsView()
            }
        }
        .environment(\.fantoProfile, fantoProfile)
        .task { await fantoProfile.load() }
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
