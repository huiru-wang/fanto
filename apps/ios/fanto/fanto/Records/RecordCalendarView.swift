import SwiftUI

struct RecordCalendarView: View {
    @Binding private var selectedDate: Date
    let records: [Record]
    let showTimeline: () -> Void
    let addRecord: () -> Void
    @State private var weekAnchor: Date
    @State private var showingMonthYearPicker = false
    @Namespace private var calendarNamespace
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let calendar = Calendar.current

    init(
        selectedDate: Binding<Date>,
        records: [Record],
        showTimeline: @escaping () -> Void,
        addRecord: @escaping () -> Void
    ) {
        self._selectedDate = selectedDate
        self.records = records
        self.showTimeline = showTimeline
        self.addRecord = addRecord
        self._weekAnchor = State(initialValue: Calendar.current.sundayStart(containing: selectedDate.wrappedValue))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center) {
                Button {
                    showingMonthYearPicker = true
                } label: {
                    HStack(spacing: 6) {
                        Text(ChineseDateText.monthYear(displayAnchor))
                        Image(systemName: "chevron.down")
                            .font(.title3.weight(.semibold))
                    }
                }
                .buttonStyle(.plain)
                .font(.largeTitle.bold())
                .accessibilityLabel("选择年月")
                .accessibilityValue(ChineseDateText.monthYear(displayAnchor))
                Spacer()
                HStack(spacing: 8) {
                    CalendarActionButton(
                        title: "切换到时间线模式",
                        systemImage: "list.bullet",
                        action: showTimeline
                    )
                    CalendarActionButton(title: "添加记录", systemImage: "square.and.pencil", action: addRecord)
                }
            }

            WeekCalendarStrip(
                dates: calendar.days(inWeekStarting: weekAnchor),
                selectedDate: selectedDate,
                hasRecords: hasRecords,
                select: select,
                namespace: calendarNamespace
            )
            .frame(maxWidth: .infinity, alignment: .top)
            .clipped()
            .contentShape(Rectangle())
            .simultaneousGesture(
                DragGesture(minimumDistance: 18)
                    .onEnded(handleCalendarSwipe)
            )
            .accessibilityHint("向左或向右轻扫可切换周")
            .accessibilityAction(named: previousButtonTitle, previousPage)
            .accessibilityAction(named: nextButtonTitle, nextPage)
            .animation(calendarAnimation, value: displayAnchor)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .contain)
        .sheet(isPresented: $showingMonthYearPicker) {
            MonthYearPickerSheet(date: displayAnchor) { year, month in
                select(year: year, month: month)
            }
            .presentationDetents([.height(340)])
            .presentationDragIndicator(.visible)
        }
    }

    private var displayAnchor: Date {
        weekAnchor
    }

    private var calendarAnimation: Animation {
        reduceMotion ? .easeOut(duration: 0.15) : .smooth(duration: 0.38, extraBounce: 0)
    }

    private var previousButtonTitle: String {
        "上一周"
    }

    private var nextButtonTitle: String {
        "下一周"
    }

    private func hasRecords(on date: Date) -> Bool {
        records.contains { calendar.isDate($0.eventAt, inSameDayAs: date) }
    }

    private func select(_ date: Date) {
        withAnimation(calendarAnimation) {
            selectedDate = calendar.startOfDay(for: date)
            weekAnchor = calendar.sundayStart(containing: date)
        }
    }

    private func select(year: Int, month: Int) {
        let currentDay = calendar.component(.day, from: selectedDate)
        var components = DateComponents(year: year, month: month, day: 1)
        guard let firstDay = calendar.date(from: components),
              let dayRange = calendar.range(of: .day, in: .month, for: firstDay)
        else { return }

        components.day = min(currentDay, dayRange.count)
        guard let date = calendar.date(from: components) else { return }
        select(date)
    }

    private func previousPage() {
        changePage(by: -1)
    }

    private func nextPage() {
        changePage(by: 1)
    }

    private func handleCalendarSwipe(_ value: DragGesture.Value) {
        let horizontal = value.translation.width
        let vertical = value.translation.height
        guard abs(horizontal) >= 44, abs(horizontal) > abs(vertical) else { return }
        changePage(by: horizontal < 0 ? 1 : -1)
    }

    private func changePage(by amount: Int) {
        withAnimation(calendarAnimation) {
            weekAnchor = calendar.date(byAdding: .day, value: 7 * amount, to: weekAnchor) ?? weekAnchor
        }
    }
}
