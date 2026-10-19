import Foundation
import CoreLocation
import MapKit

@main
struct LocationTests {
    static func main() {
        // New MapKit responses can carry a formatted address without a legacy placemark name.
        let result = MKMapItem(
            location: CLLocation(latitude: 37.785, longitude: -122.406),
            address: MKAddress(fullAddress: "San Francisco, CA, United States", shortAddress: "Market Street")
        )
        result.name = nil
        let requested = CLLocationCoordinate2D(latitude: 37.784, longitude: -122.405)
        let resolved = RecordLocationFormatter.location(from: result, coordinate: requested, fallbackName: "当前位置")
        precondition(resolved.name == "Market Street", "Modern formatted addresses must not be discarded")
        precondition(resolved.latitude == requested.latitude && resolved.longitude == requested.longitude,
                     "A nearby geocoded building must not move the selected coordinate")

        result.name = "Nearby café"
        let searched = RecordLocationFormatter.location(from: result, name: result.name, fallbackName: "未命名地点")
        precondition(searched.name == "Nearby café", "Search must preserve the selected POI name")

        let placemark = MKPlacemark(coordinate: requested, addressDictionary: [
            "CountryCode": "US", "Country": "United States", "State": "California",
            "City": "San Francisco", "SubLocality": "SoMa", "Name": "Selected place"
        ])
        let legacy = RecordLocationFormatter.location(from: MKMapItem(placemark: placemark), fallbackName: "地图选点")
        precondition(legacy.countryCode == "US" && legacy.province == "California")
        precondition(legacy.city == "San Francisco" && legacy.district == "SoMa")

        let unresolvedItem = MKMapItem(location: result.location, address: nil)
        let unresolved = RecordLocationFormatter.location(from: unresolvedItem, fallbackName: "当前位置")
        precondition(unresolved.name == "当前位置", "MapKit's generic unknown name must use the coordinate fallback")

        let fallback = RecordLocation(name: "当前位置", latitude: requested.latitude, longitude: requested.longitude)
        precondition(RecordLocationFormatter.detailText(for: fallback) == "地址暂未识别，可重新选点")
        var municipality = fallback
        municipality.country = "中国"
        municipality.province = "北京市"
        municipality.city = "北京市"
        municipality.district = "西城区"
        precondition(RecordLocationFormatter.detailText(for: municipality) == "中国 · 北京市 · 西城区")
        print("PASS: modern addresses, legacy administrative fields, exact coordinates and unresolved address fallback")
    }
}
