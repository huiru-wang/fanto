import SwiftUI

struct ConversationComposerGlass: ViewModifier {
    let reduceTransparency: Bool

    func body(content: Content) -> some View {
        if reduceTransparency {
            content
                .background(.background, in: RoundedRectangle(cornerRadius: 30))
                .overlay {
                    RoundedRectangle(cornerRadius: 30)
                        .stroke(.secondary, lineWidth: 1)
                }
        } else if #available(iOS 26, *) {
            content.glassEffect(.regular, in: RoundedRectangle(cornerRadius: 30))
        } else {
            content.background(.regularMaterial, in: RoundedRectangle(cornerRadius: 30))
        }
    }
}
