import SwiftUI

struct ContinuousRecordTimelineView: View {
    let records: [Record]
    let hasMore: Bool
    let isLoadingMore: Bool
    let loadMoreError: String?
    let showCalendar: () -> Void
    let addRecord: () -> Void
    let loadMore: () -> Void

    private let calendar = Calendar.current

    var body: some View {
        LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
            header

            if records.isEmpty {
                ContentUnavailableView(
                    "还没有记录",
                    systemImage: "circle.dashed",
                    description: Text("从一条此刻的想法开始。")
                )
                .frame(maxWidth: .infinity)
                .padding(.top, 72)
            } else {
                ForEach(dayGroups) { group in
                    Section {
                        ForEach(group.records) { record in
                            ContinuousTimelineRecordRow(
                                record: record,
                                showsLineAfter: record.id != group.records.last?.id
                            )
                        }
                    } header: {
                        dayHeader(group)
                    }
                }

                paginationFooter
            }
        }
    }

    private var header: some View {
        HStack(alignment: .center) {
            Text("记录")
                .font(.largeTitle.bold())

            Spacer()

            HStack(spacing: 8) {
                CalendarActionButton(
                    title: "切换到日历模式",
                    systemImage: "calendar",
                    action: showCalendar
                )
                CalendarActionButton(title: "添加记录", systemImage: "square.and.pencil", action: addRecord)
            }
        }
        .padding(.bottom, 20)
    }

    private func dayHeader(_ group: TimelineDayGroup) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(ChineseDateText.timelineTitle(group.date))
                .font(.title3.bold())
            Spacer()
            Text("\(group.records.count) 条记录")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding(.top, 20)
        .padding(.bottom, 14)
        .background(Color(uiColor: .systemBackground))
    }

    @ViewBuilder
    private var paginationFooter: some View {
        if isLoadingMore {
            ProgressView("正在加载更早的记录")
                .frame(maxWidth: .infinity)
                .padding(.vertical, 28)
        } else if let loadMoreError {
            Button {
                loadMore()
            } label: {
                Label("加载失败，点按重试", systemImage: "arrow.clockwise")
                    .font(.subheadline.weight(.medium))
            }
            .buttonStyle(.bordered)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 28)
            .accessibilityHint(loadMoreError)
        } else if hasMore {
            Color.clear
                .frame(height: 1)
                .padding(.vertical, 28)
                .onAppear(perform: loadMore)
                .accessibilityLabel("加载更早的记录")
        } else {
            Text("已经到最早的记录")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 28)
        }
    }

    private var dayGroups: [TimelineDayGroup] {
        let grouped = Dictionary(grouping: records) { calendar.startOfDay(for: $0.eventAt) }
        return grouped
            .map { date, records in
                TimelineDayGroup(date: date, records: records.sorted { $0.eventAt > $1.eventAt })
            }
            .sorted { $0.date > $1.date }
    }
}

private struct TimelineDayGroup: Identifiable {
    let date: Date
    let records: [Record]

    var id: Date { date }
}

private struct ContinuousTimelineRecordRow: View {
    let record: Record
    let showsLineAfter: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text(record.eventAt.formatted(date: .omitted, time: .shortened))
                .font(.subheadline.monospacedDigit())
                .foregroundStyle(.secondary)
                .frame(width: 56, alignment: .trailing)
                .padding(.top, 1)

            VStack(spacing: 0) {
                Circle()
                    .fill(FantoTheme.accent)
                    .frame(width: 10, height: 10)
                    .padding(.top, 5)
                Rectangle()
                    .fill(Color.secondary.opacity(0.25))
                    .frame(width: 1)
                    .frame(maxHeight: .infinity)
                    .opacity(showsLineAfter ? 1 : 0)
            }
            .frame(width: 10)

            VStack(alignment: .leading, spacing: 8) {
                Text(record.text)
                    .font(.body)
                    .fixedSize(horizontal: false, vertical: true)

                if let media = record.media {
                    RecordMediaView(media: media)
                }

                if let location = record.location {
                    Label(location, systemImage: "location")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Text(FantoDateText.timestamp(record.eventAt))
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
            .padding(.bottom, 24)
        }
        .accessibilityElement(children: .combine)
    }
}
