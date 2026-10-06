import CoreLocation
import Foundation

enum RecordLocationFormatter {
    // MKAddressRepresentations does not expose district or ISO country code yet.
    // Keep the MapKit item's placemark for the structured Record location contract.
    static func location(from placemark: CLPlacemark, name explicitName: String? = nil, fallbackName: String) -> RecordLocation {
        RecordLocation(
            name: clean(explicitName) ?? clean(placemark.name) ?? fallbackName,
            countryCode: clean(placemark.isoCountryCode)?.uppercased(),
            country: clean(placemark.country),
            province: clean(placemark.administrativeArea),
            city: clean(placemark.locality) ?? clean(placemark.subAdministrativeArea),
            district: clean(placemark.subLocality),
            latitude: placemark.location?.coordinate.latitude ?? 0,
            longitude: placemark.location?.coordinate.longitude ?? 0
        )
    }

    static func administrativeText(for location: RecordLocation) -> String {
        distinct([location.country, location.province, location.city, location.district]).joined(separator: " · ")
    }

    private static func clean(_ value: String?) -> String? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
        return value
    }

    private static func distinct(_ values: [String?]) -> [String] {
        var seen = Set<String>()
        return values.compactMap(clean).filter { value in
            seen.insert(value.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)).inserted
        }
    }
}
