import SwiftUI

struct CreationRow: View {
    let creation: Creation

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(creation.kind.title, systemImage: creation.kind.symbol)
                .font(.caption)
                .foregroundStyle(FantoTheme.accent)
            Text(creation.title)
                .font(.headline)
            Text(creation.summary)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 8) {
                Label(creation.status.title, systemImage: creation.status.symbol)
                if let sourceCount = creation.sourceCount {
                    Text("\(sourceCount) 条记录")
                }
                Text(FantoDateText.timestamp(creation.updatedAt))
            }
            .font(.caption)
            .foregroundStyle(.tertiary)
        }
        .padding(.vertical, 6)
    }
}
