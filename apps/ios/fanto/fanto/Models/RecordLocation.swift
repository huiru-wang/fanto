import Foundation

nonisolated struct RecordLocation: Hashable, Codable, Sendable {
    var name: String
    var countryCode: String? = nil
    var country: String? = nil
    var province: String? = nil
    var city: String? = nil
    var district: String? = nil
    var latitude: Double
    var longitude: Double
}
