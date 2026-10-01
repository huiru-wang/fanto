import SwiftUI

struct RecordsView: View {
    @Environment(FantoStore.self) private var store
    @State private var showingComposer = false
    @State private var selectedDate = Calendar.current.startOfDay(for: .now)
    @State private var viewMode: RecordViewMode = .calendar

    private let calendar = Calendar.current

    var body: some View {
        NavigationStack {
            Group {
                switch viewMode {
                case .calendar:
                    calendarView
                case .timeline:
                    timelineView
                }
            }
            .sheet(isPresented: $showingComposer) {
                RecordComposerView { eventAt in
                    selectedDate = calendar.startOfDay(for: eventAt)
                }
            }
            .refreshable {
                await store.loadRecords()
            }
        }
    }

    private var calendarView: some View {
        ScrollView {
            let dayRecords = store.records
                .filter { calendar.isDate($0.eventAt, inSameDayAs: selectedDate) }
                .sorted { $0.eventAt > $1.eventAt }
            LazyVStack(alignment: .leading, spacing: 28) {
                RecordCalendarView(
                    selectedDate: $selectedDate,
                    records: store.records,
                    showTimeline: { viewMode = .timeline },
                    addRecord: { showingComposer = true }
                )
                timeline(date: selectedDate, records: dayRecords)
            }
            .padding(.horizontal)
            .padding(.bottom, 28)
        }
    }

    private var timelineView: some View {
        ScrollView {
            Group {
                switch store.recordLoadState {
                case .idle, .loading:
                    timelineHeader
                    ProgressView("正在读取记录")
                        .frame(maxWidth: .infinity)
                        .padding(.top, 72)
                case let .failed(message):
                    timelineHeader
                    VStack(spacing: 16) {
                        ContentUnavailableView("暂时无法读取记录", systemImage: "wifi.exclamationmark", description: Text(message))
                        Button("重新加载") {
                            Task { await store.loadRecords() }
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 48)
                case let .loaded(hasMore):
                    ContinuousRecordTimelineView(
                        records: store.records,
                        hasMore: hasMore,
                        isLoadingMore: store.isLoadingMoreRecords,
                        loadMoreError: store.recordLoadMoreError,
                        showCalendar: { viewMode = .calendar },
                        addRecord: { showingComposer = true },
                        loadMore: { Task { await store.loadMoreRecords() } }
                    )
                }
            }
            .padding(.horizontal)
            .padding(.bottom, 28)
        }
    }

    private var timelineHeader: some View {
        HStack(alignment: .center) {
            Text("记录")
                .font(.largeTitle.bold())
            Spacer()
            HStack(spacing: 8) {
                CalendarActionButton(
                    title: "切换到日历模式",
                    systemImage: "calendar",
                    action: { viewMode = .calendar }
                )
                CalendarActionButton(
                    title: "添加记录",
                    systemImage: "square.and.pencil",
                    action: { showingComposer = true }
                )
            }
        }
        .padding(.bottom, 20)
    }

    @ViewBuilder
    private func timeline(date: Date, records: [Record]) -> some View {
        switch store.recordLoadState {
        case .idle, .loading:
            VStack(spacing: 12) {
                Text(ChineseDateText.timelineTitle(date))
                    .font(.title3)
                    .bold()
                    .frame(maxWidth: .infinity, alignment: .leading)
                ProgressView("正在读取记录")
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 36)
            }
        case let .failed(message):
            VStack(spacing: 16) {
                ContentUnavailableView("暂时无法读取记录", systemImage: "wifi.exclamationmark", description: Text(message))
                Button("重新加载") {
                    Task { await store.loadRecords() }
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 24)
        case .loaded:
            RecordTimelineView(date: date, records: records)
        }
    }
}

private enum RecordViewMode {
    case calendar
    case timeline
}
