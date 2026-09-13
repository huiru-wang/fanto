import SwiftUI

struct RecordTimelineView: View {
    let date: Date
    let records: [Record]

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text(ChineseDateText.timelineTitle(date))
                .font(.title3)
                .bold()
            if records.isEmpty {
                ContentUnavailableView("这一天还没有记录", systemImage: "circle.dashed", description: Text("留一点空白也很好。"))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 36)
            } else {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(records) { record in
                        TimelineRecordRow(record: record, showsLineAfter: record.id != records.last?.id)
                    }
                }
            }
        }
    }
}
