import SwiftUI

struct RecordsView: View {
    @Environment(FantoStore.self) private var store
    @State private var showingComposer = false
    @State private var recordToDelete: Record?
    @State private var showsDeletionConfirmation = false
    @State private var selectedDate = Calendar.current.startOfDay(for: .now)
    @State private var viewMode: RecordViewMode = .calendar
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let calendar = Calendar.current

    var body: some View {
        NavigationStack {
            ZStack {
                switch viewMode {
                case .calendar:
                    calendarView
                        .transition(.asymmetric(
                            insertion: .opacity.combined(with: .move(edge: .leading)),
                            removal: .opacity.combined(with: .move(edge: .trailing))
                        ))
                case .timeline:
                    timelineView
                        .transition(.asymmetric(
                            insertion: .opacity.combined(with: .move(edge: .trailing)),
                            removal: .opacity.combined(with: .move(edge: .leading))
                        ))
                }
            }
            .animation(reduceMotion ? nil : .smooth(duration: 0.28, extraBounce: 0), value: viewMode)
            .sheet(isPresented: $showingComposer) {
                RecordComposerView { eventAt in
                    selectedDate = calendar.startOfDay(for: eventAt)
                }
            }
            .refreshable {
                await store.loadRecords()
            }
            .confirmationDialog("删除这条记录？", isPresented: $showsDeletionConfirmation, titleVisibility: .visible) {
                Button("删除记录", role: .destructive) {
                    guard let record = recordToDelete else { return }
                    Task { await store.deleteRecord(record) }
                    recordToDelete = nil
                }
                Button("取消", role: .cancel) { recordToDelete = nil }
            } message: {
                Text("删除后无法恢复。仅属于这条记录的照片和音频也会删除，已有脉络成果会保留。")
            }
            .alert("删除未完成", isPresented: Binding(
                get: { store.recordActionError != nil },
                set: { if !$0 { store.recordActionError = nil } }
            )) {
                Button("好", role: .cancel) { store.recordActionError = nil }
            } message: {
                Text(store.recordActionError ?? "请稍后重试。")
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
                    showTimeline: { switchView(to: .timeline) },
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
                        showCalendar: { switchView(to: .calendar) },
                        addRecord: { showingComposer = true },
                        loadMore: { Task { await store.loadMoreRecords() } },
                        deleteRecord: confirmDeletion
                    )
                }
            }
            .padding(.horizontal)
            .padding(.bottom, 28)
        }
    }

    private var timelineHeader: some View {
        HStack(alignment: .center) {
            Text("时间线")
                .font(.largeTitle.bold())
            Spacer()
            HStack(spacing: 8) {
                CalendarActionButton(
                    title: "切换到日历模式",
                    systemImage: "calendar",
                    action: { switchView(to: .calendar) }
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
            RecordTimelineView(date: date, records: records, deleteRecord: confirmDeletion)
        }
    }

    private func confirmDeletion(_ record: Record) {
        guard !store.deletingRecordIDs.contains(record.id) else { return }
        recordToDelete = record
        showsDeletionConfirmation = true
    }

    private func switchView(to mode: RecordViewMode) {
        guard viewMode != mode else { return }
        viewMode = mode
    }
}

private enum RecordViewMode: Equatable {
    case calendar
    case timeline
}
