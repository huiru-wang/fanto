import CoreLocation
import Foundation
import MapKit

enum RecordLocationFormatter {
    // Modern MapKit results can have an address even when legacy placemark fields are empty.
    // Retain the requested coordinate: the returned address may describe a nearby building.
    static func location(from item: MKMapItem, coordinate: CLLocationCoordinate2D? = nil, name explicitName: String? = nil, fallbackName: String) -> RecordLocation {
        let placemark = item.placemark
        let address = item.addressRepresentations
        let coordinate = coordinate ?? item.location.coordinate
        return RecordLocation(
            name: clean(explicitName) ?? clean(item.address?.shortAddress)
                ?? clean(address?.fullAddress(includingRegion: false, singleLine: true))
                ?? clean(item.address?.fullAddress) ?? placeName(item.name) ?? placeName(placemark.name) ?? fallbackName,
            countryCode: clean(placemark.isoCountryCode)?.uppercased(),
            country: clean(placemark.country) ?? clean(address?.regionName),
            province: clean(placemark.administrativeArea),
            city: clean(placemark.locality) ?? clean(address?.cityName) ?? clean(placemark.subAdministrativeArea),
            district: clean(placemark.subLocality),
            latitude: coordinate.latitude,
            longitude: coordinate.longitude
        )
    }

    static func detailText(for location: RecordLocation) -> String {
        let text = administrativeText(for: location)
        if !text.isEmpty { return text }
        return ["当前位置", "地图选点"].contains(location.name) ? "地址暂未识别，可重新选点" : ""
    }

    static func administrativeText(for location: RecordLocation) -> String {
        distinct([location.country, location.province, location.city, location.district]).joined(separator: " · ")
    }

    private static func placeName(_ value: String?) -> String? {
        guard let value = clean(value),
              !["unknown location", "未知位置", "未知地点"].contains(value.lowercased()) else { return nil }
        return value
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
