import SwiftUI

struct UserAvatar: View {
    let mediaID: String?
    var size: CGFloat = 44
    @State private var url: URL?
    @State private var resolvedID: String?
    @State private var retry = 0
    var body: some View {
        Group {
            if resolvedID == mediaID, let url {
                AsyncImage(url: url) { phase in
                    if let image = phase.image { image.resizable().scaledToFill() }
                    else { placeholder.onAppear { if phase.error != nil && retry == 0 { retry = 1 } } }
                }
            } else { placeholder }
        }
        .frame(width: size, height: size).clipShape(Circle())
        .accessibilityLabel("你的头像")
        .onChange(of: mediaID) { _, _ in url = nil; resolvedID = nil; retry = 0 }
        .task(id: "\(mediaID ?? "default")/\(retry)") {
            guard let mediaID else { return }
            do {
                let value = try await FantoAPIClient.shared.fetchMediaReadURL(id: mediaID, variant: .thumbnail)
                try Task.checkCancellation(); url = value; resolvedID = mediaID
            } catch { }
        }
    }
    private var placeholder: some View {
        Image(systemName: "person.crop.circle.fill").resizable().scaledToFit()
            .symbolRenderingMode(.hierarchical).foregroundStyle(.secondary)
            .background(Color(uiColor: .secondarySystemGroupedBackground), in: Circle())
    }
}
