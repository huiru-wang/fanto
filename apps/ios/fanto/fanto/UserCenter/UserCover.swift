import SwiftUI

struct UserCover: View {
    let mediaID: String?
    var body: some View {
        Group {
            if let mediaID {
                CachedMediaImage(mediaID: mediaID) { phase in
                    if let image = phase.image { image.resizable().scaledToFill() }
                    else { Color(uiColor: .secondarySystemGroupedBackground) }
                }
            } else { Image("UserCenterCover").resizable().scaledToFill() }
        }
    }
}
