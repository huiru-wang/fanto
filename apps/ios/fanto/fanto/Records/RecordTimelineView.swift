import SwiftUI

struct RecordTimelineView: View {
    @Environment(FantoStore.self) private var store
    let date: Date
    let records: [Record]
    var deleteRecord: (Record) -> Void = { _ in }

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
                            .opacity(store.deletingRecordIDs.contains(record.id) ? 0.5 : 1)
                            .overlay(alignment: .trailing) {
                                if store.deletingRecordIDs.contains(record.id) { ProgressView("正在删除") }
                            }
                            .contextMenu {
                                Button("删除记录", systemImage: "trash", role: .destructive) { deleteRecord(record) }
                            }
                            .accessibilityAction(named: "删除记录") { deleteRecord(record) }
                    }
                }
            }
        }
    }
}
