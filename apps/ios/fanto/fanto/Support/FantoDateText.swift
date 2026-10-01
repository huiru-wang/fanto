import Foundation

@MainActor
enum FantoDateText {
    private static let timestampFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return formatter
    }()

    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = .current
        formatter.dateFormat = "HH:mm"
        return formatter
    }()

    static func timestamp(_ date: Date) -> String {
        timestampFormatter.string(from: date)
    }

    static func time(_ date: Date) -> String {
        timeFormatter.string(from: date)
    }
}
