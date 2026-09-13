import SwiftUI

struct CreationSourceTimelineRow: View {
    let record: CreationSourceRecord
    let showsLineAfter: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(spacing: 0) {
                Circle()
                    .fill(FantoTheme.accent)
                    .frame(width: 8, height: 8)
                    .padding(.top, 7)
                Rectangle()
                    .fill(Color.secondary.opacity(0.35))
                    .frame(width: 1)
                    .frame(maxHeight: .infinity)
                    .opacity(showsLineAfter ? 1 : 0)
            }
            .frame(width: 8)

            VStack(alignment: .leading, spacing: 8) {
                Text(record.text)
                    .font(.body)
                    .fixedSize(horizontal: false, vertical: true)
                Text(FantoDateText.timestamp(record.createdAt))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(.bottom, 22)
        }
        .accessibilityElement(children: .combine)
    }
}
