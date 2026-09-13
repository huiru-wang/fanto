import Foundation

enum RecordMedia: Hashable {
    case photos(count: Int)
    case audio(duration: TimeInterval)
}
