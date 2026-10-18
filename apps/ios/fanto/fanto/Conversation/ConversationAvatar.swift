import SwiftUI

struct ConversationAvatar: View {
    let isFanto: Bool
    var size: CGFloat = 30
    var personalized = false
    @Environment(\.userProfile) private var userProfile
    @Environment(\.fantoProfile) private var profile
    private var mediaID: String? { personalized ? profile?.settings?.avatarMediaId : nil }

    var body: some View {
        Group {
            if isFanto {
                if let mediaID {
                    CachedMediaImage(mediaID: mediaID, variant: .thumbnail) { phase in
                        if let image = phase.image { image.resizable().scaledToFill() }
                        else {
                            Color(uiColor: .secondarySystemGroupedBackground).overlay {
                                if phase.error != nil { Image(systemName: "photo").foregroundStyle(.secondary) }
                                else { ProgressView() }
                            }
                        }
                    }
                } else { brand }
            } else {
                UserAvatar(mediaID: userProfile?.profile?.avatarMediaId, size: size)
            }
        }
        .frame(width: size, height: size)
        .background(isFanto ? Color.white : Color.clear, in: Circle())
        .clipShape(Circle())
        .accessibilityLabel(isFanto ? (personalized ? profile?.settings?.nickname ?? "Fanto" : "Fanto") : "你")

    }
    private var brand: some View { Image("FantoAvatar").resizable().scaledToFill() }
}
