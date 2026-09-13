import SwiftUI

struct MonthCalendarGrid: View {
    let dates: [Date]
    let monthDate: Date
    let selectedDate: Date
    let hasRecords: (Date) -> Bool
    let select: (Date) -> Void
    let namespace: Namespace.ID

    private let calendar = Calendar.current
    private let columns = Array(repeating: GridItem(.flexible(), spacing: 0), count: 7)

    var body: some View {
        VStack(spacing: 4) {
            CalendarWeekdayHeader()
            LazyVGrid(columns: columns, spacing: 0) {
                ForEach(dates, id: \.self) { date in
                    CalendarDayButton(
                        date: date,
                        isSelected: calendar.isDate(date, inSameDayAs: selectedDate),
                        hasRecords: hasRecords(date),
                        isMuted: !calendar.isDate(date, equalTo: monthDate, toGranularity: .month),
                        showsWeekday: false,
                        action: { select(date) }
                    )
                    .matchedGeometryEffect(id: date, in: namespace)
                }
            }
        }
        .padding(.vertical, 4)
    }
}
