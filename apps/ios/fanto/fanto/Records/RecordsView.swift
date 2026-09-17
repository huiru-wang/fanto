import SwiftUI

struct RecordsView: View {
    @Environment(FantoStore.self) private var store
    @State private var showingComposer = false
    @State private var selectedDate = Calendar.current.startOfDay(for: .now)

    private let calendar = Calendar.current

    var body: some View {
        NavigationStack {
            ScrollView {
                let dayRecords = store.records
                    .filter { calendar.isDate($0.eventAt, inSameDayAs: selectedDate) }
                    .sorted { $0.eventAt > $1.eventAt }
                LazyVStack(alignment: .leading, spacing: 28) {
                    RecordCalendarView(selectedDate: $selectedDate, records: store.records) {
                        showingComposer = true
                    }
                    timeline(date: selectedDate, records: dayRecords)
                }
                .padding(.horizontal)
                .padding(.bottom, 28)
            }
            .sheet(isPresented: $showingComposer) {
                RecordComposerView { eventAt in
                    selectedDate = calendar.startOfDay(for: eventAt)
                }
                    .presentationDetents([.medium, .large])
                    .presentationDragIndicator(.visible)
            }
            .refreshable {
                await store.loadRecords()
            }
        }
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
