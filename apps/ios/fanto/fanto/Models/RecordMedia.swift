import Foundation

struct RecordPhoto: Identifiable, Hashable {
    let id: String
}

enum RecordMedia: Hashable {
    case photos([RecordPhoto])
    case audio(duration: TimeInterval)
}
