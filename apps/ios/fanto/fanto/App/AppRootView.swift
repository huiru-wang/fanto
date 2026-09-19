import SwiftUI

enum AppTab: Hashable {
    case records
    case fanto
    case creations
}

struct AppRootView: View {
    @State private var selection: AppTab = .records
    @State private var conversationStore = ConversationStore()

    var body: some View {
        TabView(selection: $selection) {
            Tab("记录", systemImage: "rectangle.stack", value: .records) {
                RecordsView()
            }
            Tab("Fanto", systemImage: "message", value: .fanto) {
                FantoConversationView(store: conversationStore)
            }
            Tab("脉络", systemImage: "point.3.connected.trianglepath.dotted", value: .creations) {
                CreationsView()
            }
        }
        .tint(FantoTheme.accent)
    }
}

#Preview {
    AppRootView()
        .environment(FantoStore.preview)
}
