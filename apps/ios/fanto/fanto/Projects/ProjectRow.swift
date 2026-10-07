import SwiftUI

struct ProjectRow: View {
    let project: Project

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(project.title)
                .font(.headline)
            if !project.summary.isEmpty {
                Text(project.summary)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
            }
            HStack(spacing: 8) {
                Label(project.status.title, systemImage: project.status.symbol)
                Text(FantoDateText.timestamp(project.updatedAt))
            }
            .font(.caption)
            .foregroundStyle(.tertiary)
        }
        .padding(.vertical, 6)
    }
}
