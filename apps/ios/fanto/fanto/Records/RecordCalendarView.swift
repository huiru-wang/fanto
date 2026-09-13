import SwiftUI

struct RecordCalendarView: View {
    @Binding private var selectedDate: Date
    let records: [Record]
    let addRecord: () -> Void
    @State private var weekAnchor: Date
    @State private var monthAnchor: Date
    @State private var presentation: CalendarPresentation = .week
    @Namespace private var calendarNamespace
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let calendar = Calendar.current

    init(selectedDate: Binding<Date>, records: [Record], addRecord: @escaping () -> Void) {
        self._selectedDate = selectedDate
        self.records = records
        self.addRecord = addRecord
        self._weekAnchor = State(initialValue: Calendar.current.sundayStart(containing: selectedDate.wrappedValue))
        self._monthAnchor = State(initialValue: Calendar.current.startOfMonth(containing: selectedDate.wrappedValue))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center) {
                Text(ChineseDateText.monthYear(displayAnchor))
                    .font(.largeTitle)
                    .bold()
                Spacer()
                HStack(spacing: 8) {
                    CalendarActionButton(
                        title: presentation == .week ? "展开月历" : "收起月历",
                        systemImage: presentation == .week ? "calendar" : "rectangle.compress.vertical",
                        action: togglePresentation
                    )
                    CalendarActionButton(title: "新建记录", systemImage: "square.and.pencil", action: addRecord)
                }
            }

            HStack {
                Spacer()
                Button(previousButtonTitle, systemImage: "chevron.left", action: previousPage)
                    .labelStyle(.iconOnly)
                Button(nextButtonTitle, systemImage: "chevron.right", action: nextPage)
                    .labelStyle(.iconOnly)
            }
            .font(.caption)
            .foregroundStyle(.secondary)

            ZStack(alignment: .top) {
                if presentation == .week {
                    WeekCalendarStrip(
                        dates: calendar.days(inWeekStarting: weekAnchor),
                        selectedDate: selectedDate,
                        hasRecords: hasRecords,
                        select: select,
                        namespace: calendarNamespace
                    )
                    .transition(reduceMotion ? .opacity : .identity)
                } else {
                    MonthCalendarGrid(
                        dates: calendar.days(inMonthContaining: monthAnchor),
                        monthDate: monthAnchor,
                        selectedDate: selectedDate,
                        hasRecords: hasRecords,
                        select: select,
                        namespace: calendarNamespace
                    )
                    .transition(reduceMotion ? .opacity : .identity)
                }
            }
            .frame(maxWidth: .infinity, alignment: .top)
            .clipped()
            .animation(calendarAnimation, value: presentation)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .contain)
    }

    private var displayAnchor: Date {
        presentation == .week ? weekAnchor : monthAnchor
    }

    private var calendarAnimation: Animation {
        reduceMotion ? .easeOut(duration: 0.15) : .smooth(duration: 0.38, extraBounce: 0)
    }

    private var previousButtonTitle: String {
        presentation == .week ? "上一周" : "上个月"
    }

    private var nextButtonTitle: String {
        presentation == .week ? "下一周" : "下个月"
    }

    private func hasRecords(on date: Date) -> Bool {
        records.contains { calendar.isDate($0.createdAt, inSameDayAs: date) }
    }

    private func select(_ date: Date) {
        withAnimation(calendarAnimation) {
            selectedDate = calendar.startOfDay(for: date)
            weekAnchor = calendar.sundayStart(containing: date)
            monthAnchor = calendar.startOfMonth(containing: date)
            if presentation == .month {
                presentation = .week
            }
        }
    }

    private func togglePresentation() {
        withAnimation(calendarAnimation) {
            if presentation == .week {
                monthAnchor = calendar.startOfMonth(containing: weekAnchor)
                presentation = .month
            } else {
                weekAnchor = calendar.sundayStart(containing: selectedDate)
                presentation = .week
            }
        }
    }

    private func previousPage() {
        withAnimation(calendarAnimation) {
            if presentation == .week {
                weekAnchor = calendar.date(byAdding: .day, value: -7, to: weekAnchor) ?? weekAnchor
            } else {
                monthAnchor = calendar.date(byAdding: .month, value: -1, to: monthAnchor) ?? monthAnchor
            }
        }
    }

    private func nextPage() {
        withAnimation(calendarAnimation) {
            if presentation == .week {
                weekAnchor = calendar.date(byAdding: .day, value: 7, to: weekAnchor) ?? weekAnchor
            } else {
                monthAnchor = calendar.date(byAdding: .month, value: 1, to: monthAnchor) ?? monthAnchor
            }
        }
    }
}
