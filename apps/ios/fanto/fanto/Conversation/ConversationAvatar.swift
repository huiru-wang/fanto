import SwiftUI

struct ConversationAvatar: View {
    let isFanto: Bool
    var size: CGFloat = 30
    var personalized = false
    @Environment(\.fantoProfile) private var profile
    @State private var resolvedID: String?
    @State private var url: URL?
    @State private var retry = 0
    private var mediaID: String? { personalized ? profile?.settings?.avatarMediaId : nil }

    var body: some View {
        Group {
            if isFanto {
                if let mediaID, resolvedID == mediaID, let url {
                    AsyncImage(url: url) { phase in
                        if let image = phase.image { image.resizable().scaledToFill() }
                        else {
                            brand
                                .onAppear { if phase.error != nil && retry == 0 { retry = 1 } }
                        }
                    }
                } else { brand }
            } else {
                Image(systemName: "person.crop.circle.fill")
                    .resizable().scaledToFit().foregroundStyle(.secondary).padding(2)
            }
        }
        .frame(width: size, height: size)
        .background(isFanto ? Color.white : Color.clear, in: Circle())
        .clipShape(Circle())
        .accessibilityLabel(isFanto ? (personalized ? profile?.settings?.nickname ?? "Fanto" : "Fanto") : "你")
        .onChange(of: mediaID) { _, _ in retry = 0; url = nil; resolvedID = nil }
        .task(id: "\(mediaID ?? "default")/\(retry)") {
            guard let mediaID else { return }
            do {
                let next = try await FantoAPIClient.shared.fetchMediaReadURL(id: mediaID, variant: .thumbnail)
                try Task.checkCancellation()
                resolvedID = mediaID; url = next
            } catch { }
        }
    }
    private var brand: some View { Image("FantoAvatar").resizable().scaledToFill() }
}
