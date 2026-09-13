import SwiftUI

struct CreationKindListView: View {
    let kind: CreationKind
    @State private var creations: [Creation] = []
    @State private var error: String?

    var body: some View {
        List(creations) { creation in
            NavigationLink {
                CreationDetailView(creation: creation)
            } label: {
                CreationRow(creation: creation)
            }
        }
        .navigationTitle(kind.title)
        .navigationBarTitleDisplayMode(.inline)
        .overlay { if let error { ContentUnavailableView("无法读取脉络", systemImage: "wifi.exclamationmark", description: Text(error)) } }
        .task(id: kind.id) { do { creations = try await CreationAPIClient.shared.fetchCreations(kind: kind) } catch { self.error = error.localizedDescription } }
    }
}
