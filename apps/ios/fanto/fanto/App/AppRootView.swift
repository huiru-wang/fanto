import SwiftUI

enum AppTab: Hashable {
    case records
    case creations
}

struct AppRootView: View {
    @State private var selection: AppTab = .records

    var body: some View {
        TabView(selection: $selection) {
            Tab("记录", systemImage: "rectangle.stack", value: .records) {
                RecordsView()
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
