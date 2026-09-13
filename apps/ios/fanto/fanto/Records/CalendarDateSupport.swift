import Foundation

extension Calendar {
    func startOfMonth(containing date: Date) -> Date {
        dateInterval(of: .month, for: date)?.start ?? startOfDay(for: date)
    }

    func sundayStart(containing date: Date) -> Date {
        let start = startOfDay(for: date)
        let weekday = component(.weekday, from: start)
        return self.date(byAdding: .day, value: -(weekday - 1), to: start) ?? start
    }

    func days(inWeekStarting start: Date) -> [Date] {
        (0..<7).compactMap { date(byAdding: .day, value: $0, to: start) }
    }

    func days(inMonthContaining date: Date) -> [Date] {
        guard let month = dateInterval(of: .month, for: date) else { return [] }
        let firstWeek = sundayStart(containing: month.start)
        let lastDay = self.date(byAdding: .day, value: -1, to: month.end) ?? month.end
        let lastWeek = sundayStart(containing: lastDay)
        let count = dateComponents([.day], from: firstWeek, to: lastWeek).day ?? 0
        return (0..<(count + 7)).compactMap { self.date(byAdding: .day, value: $0, to: firstWeek) }
    }
}
