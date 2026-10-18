import SwiftUI

struct UserAvatar: View {
    let mediaID: String?
    var size: CGFloat = 44
    var body: some View {
        Group {
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
            } else { placeholder }
        }
        .frame(width: size, height: size).clipShape(Circle())
        .accessibilityLabel("你的头像")
    }
    private var placeholder: some View {
        Image(systemName: "person.crop.circle.fill").resizable().scaledToFit()
            .symbolRenderingMode(.hierarchical).foregroundStyle(.secondary)
            .background(Color(uiColor: .secondarySystemGroupedBackground), in: Circle())
    }
}
