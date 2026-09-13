import SwiftUI

struct TimelineRecordRow: View {
    let record: Record
    let showsLineAfter: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(spacing: 0) {
                Circle()
                    .fill(FantoTheme.accent)
                    .frame(width: 8, height: 8)
                    .padding(.top, 7)
                Rectangle()
                    .fill(Color.secondary.opacity(0.4))
                    .frame(width: 1)
                    .frame(maxHeight: .infinity)
                    .opacity(showsLineAfter ? 1 : 0)
            }
            .frame(width: 8)

            VStack(alignment: .leading, spacing: 10) {
                Text(record.text)
                    .font(.body)
                    .lineLimit(4)
                    .fixedSize(horizontal: false, vertical: true)
                if let media = record.media {
                    RecordMediaView(media: media)
                }
                HStack(spacing: 6) {
                    Text(FantoDateText.timestamp(record.createdAt))
                    if let location = record.location {
                        Text("·")
                        Label(location, systemImage: "location")
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            .padding(.bottom, 24)
        }
    }
}
