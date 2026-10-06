import Foundation

struct RecordLocation: Hashable, Codable {
    var name: String
    var latitude: Double
    var longitude: Double
}

struct Record: Identifiable, Hashable, Codable {
    let id: String
    let text: String
    let eventAt: Date
    let location: RecordLocation?
    let media: RecordMedia?

    init(id: String = UUID().uuidString, text: String, eventAt: Date = .now, location: RecordLocation? = nil, media: RecordMedia? = nil) {
        self.id = id
        self.text = text
        self.eventAt = eventAt
        self.location = location
        self.media = media
    }
}
