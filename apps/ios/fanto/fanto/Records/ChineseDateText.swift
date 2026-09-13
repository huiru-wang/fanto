import Foundation

enum ChineseDateText {
    private static let months = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"]
    private static let weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]
    private static let calendar = Calendar.current

    static func monthYear(_ date: Date) -> String {
        "\(monthName(for: date)) · \(calendar.component(.year, from: date))"
    }

    static func monthDay(_ date: Date) -> String {
        "\(monthName(for: date)) \(calendar.component(.day, from: date)) 日"
    }

    static func timelineTitle(_ date: Date) -> String {
        "\(monthDay(date)) · \(weekdayName(for: date))"
    }

    private static func monthName(for date: Date) -> String {
        months[calendar.component(.month, from: date) - 1]
    }

    private static func weekdayName(for date: Date) -> String {
        weekdays[calendar.component(.weekday, from: date) - 1]
    }
}
