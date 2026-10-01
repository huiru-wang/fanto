import Foundation

struct RecordPhoto: Identifiable, Hashable {
    let id: String
}

struct RecordAudio: Identifiable, Hashable {
    let id: String
    let duration: TimeInterval
}

struct RecordMedia: Hashable {
    let photos: [RecordPhoto]
    let audio: RecordAudio?

    var isEmpty: Bool {
        photos.isEmpty && audio == nil
    }
}
