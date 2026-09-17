import Foundation

struct Record: Identifiable, Hashable {
    let id: String
    let text: String
    let eventAt: Date
    let location: String?
    let media: RecordMedia?

    init(id: String = UUID().uuidString, text: String, eventAt: Date = .now, location: String? = nil, media: RecordMedia? = nil) {
        self.id = id
        self.text = text
        self.eventAt = eventAt
        self.location = location
        self.media = media
    }
}
