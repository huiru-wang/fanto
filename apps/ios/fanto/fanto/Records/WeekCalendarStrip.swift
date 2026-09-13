import SwiftUI

struct WeekCalendarStrip: View {
    let dates: [Date]
    let selectedDate: Date
    let hasRecords: (Date) -> Bool
    let select: (Date) -> Void
    let namespace: Namespace.ID

    private let calendar = Calendar.current

    var body: some View {
        HStack(spacing: 0) {
            ForEach(dates, id: \.self) { date in
                CalendarDayButton(
                    date: date,
                    isSelected: calendar.isDate(date, inSameDayAs: selectedDate),
                    hasRecords: hasRecords(date),
                    isMuted: false,
                    showsWeekday: true,
                    action: { select(date) }
                )
                .matchedGeometryEffect(id: date, in: namespace)
            }
        }
        .padding(.vertical, 4)
    }
}
