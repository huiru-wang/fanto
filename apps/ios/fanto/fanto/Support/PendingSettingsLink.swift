import SwiftUI

/// Navigation scaffolding only. Unavailable features must not look like completed actions.
struct PendingSettingsLink: View {
    let title: String
    let symbol: String
    var destructive = false
    var status = "即将开放"

    var body: some View {
        NavigationLink {
            ContentUnavailableView(title, systemImage: symbol,
                description: Text("\(status)，后续版本将补充此页面。"))
                .navigationTitle(title)
                .navigationBarTitleDisplayMode(.inline)
        } label: {
            HStack {
                Text(title).foregroundStyle(destructive ? Color.red : Color.primary)
                Spacer()
                Text(status).font(.subheadline).foregroundStyle(.secondary)
            }
        }
        .accessibilityLabel("\(title)，\(status)")
    }
}
