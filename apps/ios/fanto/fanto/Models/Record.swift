import Foundation

struct Record: Identifiable, Hashable {
    let id: UUID
    let text: String
    let createdAt: Date
    let location: String?
    let media: RecordMedia?

    init(id: UUID = UUID(), text: String, createdAt: Date = .now, location: String? = nil, media: RecordMedia? = nil) {
        self.id = id
        self.text = text
        self.createdAt = createdAt
        self.location = location
        self.media = media
    }
}
