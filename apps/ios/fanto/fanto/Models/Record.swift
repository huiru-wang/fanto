import Foundation

struct RecordLocation: Hashable, Codable {
    var name: String
    var countryCode: String? = nil
    var country: String? = nil
    var province: String? = nil
    var city: String? = nil
    var district: String? = nil
    var latitude: Double
    var longitude: Double
}

struct Record: Identifiable, Hashable, Codable {
    let id: String
    let text: String
    let eventAt: Date
    let location: RecordLocation?
    let media: RecordMedia?
    let version: Int?

    init(id: String = UUID().uuidString, text: String, eventAt: Date = .now, location: RecordLocation? = nil, media: RecordMedia? = nil, version: Int? = nil) {
        self.id = id
        self.text = text
        self.eventAt = eventAt
        self.location = location
        self.media = media
        self.version = version
    }
}
