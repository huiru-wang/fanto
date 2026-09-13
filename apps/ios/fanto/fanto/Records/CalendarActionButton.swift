import SwiftUI

struct CalendarActionButton: View {
    let title: String
    let systemImage: String
    let action: () -> Void

    var body: some View {
        Button(title, systemImage: systemImage, action: action)
            .labelStyle(.iconOnly)
            .font(.body.weight(.semibold))
            .frame(width: 44, height: 44)
            .background(Color.secondary.opacity(0.12), in: .circle)
            .contentShape(.circle)
    }
}
