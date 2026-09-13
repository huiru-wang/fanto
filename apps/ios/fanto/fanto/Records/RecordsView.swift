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
                    .filter { calendar.isDate($0.createdAt, inSameDayAs: selectedDate) }
                    .sorted { $0.createdAt > $1.createdAt }
                LazyVStack(alignment: .leading, spacing: 28) {
                    RecordCalendarView(selectedDate: $selectedDate, records: store.records) {
                        showingComposer = true
                    }
                    RecordTimelineView(date: selectedDate, records: dayRecords)
                }
                .padding(.horizontal)
                .padding(.bottom, 28)
            }
            .sheet(isPresented: $showingComposer) {
                RecordComposerView()
                    .presentationDetents([.medium, .large])
                    .presentationDragIndicator(.visible)
            }
        }
    }
}
