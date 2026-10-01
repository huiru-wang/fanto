import Foundation

struct RecordPhoto: Identifiable, Hashable, Codable {
    let id: String
}

struct RecordAudio: Identifiable, Hashable, Codable {
    let id: String
    let duration: TimeInterval
}

struct RecordMedia: Hashable, Codable {
    let photos: [RecordPhoto]
    let audio: RecordAudio?

    var isEmpty: Bool {
        photos.isEmpty && audio == nil
    }
}
