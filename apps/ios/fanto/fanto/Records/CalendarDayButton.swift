import SwiftUI

struct CalendarDayButton: View {
    let date: Date
    let isSelected: Bool
    let hasRecords: Bool
    let isMuted: Bool
    let showsWeekday: Bool
    let action: () -> Void

    private let calendar = Calendar.current

    var body: some View {
        Button(action: action) {
            VStack(spacing: 6) {
                if showsWeekday {
                    Text(weekdays[calendar.component(.weekday, from: date) - 1])
                        .font(.caption)
                        .foregroundStyle(isMuted ? .tertiary : .secondary)
                }
                Text(date, format: .dateTime.day())
                    .font(.headline)
                    .foregroundStyle(isSelected ? Color.white : Color.primary)
                    .opacity(isMuted && !isSelected ? 0.45 : 1)
                    .frame(minWidth: 36, minHeight: 36)
                    .background(isSelected ? FantoTheme.accent : .clear, in: .circle)
                Circle()
                    .fill(isSelected ? FantoTheme.accent : FantoTheme.accent)
                    .frame(width: 5, height: 5)
                    .opacity(hasRecords ? 1 : 0)
                    .accessibilityHidden(true)
            }
            .frame(maxWidth: .infinity, minHeight: showsWeekday ? 68 : 52, alignment: .top)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(ChineseDateText.timelineTitle(date))
        .accessibilityValue(accessibilityValue)
    }

    private var accessibilityValue: String {
        switch (isSelected, hasRecords) {
        case (true, true): "已选中，有记录"
        case (true, false): "已选中"
        case (false, true): "有记录"
        case (false, false): ""
        }
    }

    private var weekdays: [String] {
        ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]
    }
}
