import CoreLocation
import Combine
import Foundation
import MapKit

@MainActor
final class RecordLocationCoordinator: NSObject, ObservableObject, CLLocationManagerDelegate {
    enum State: Equatable {
        case idle
        case locating
        case unavailable
        case denied
    }

    @Published private(set) var state: State = .idle
    @Published private(set) var suggestion: RecordLocation?

    private let manager = CLLocationManager()
    private var reverseRequest: MKReverseGeocodingRequest?
    private var locationUnknownRetryCount = 0

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    func start() {
        suggestion = nil
        locationUnknownRetryCount = 0
        guard CLLocationManager.locationServicesEnabled() else {
            state = .unavailable
            return
        }
        switch manager.authorizationStatus {
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .authorizedAlways, .authorizedWhenInUse:
            requestLocation()
        case .denied, .restricted:
            state = .denied
        @unknown default:
            state = .unavailable
        }
    }

    func stop() {
        manager.stopUpdatingLocation()
        reverseRequest?.cancel()
        reverseRequest = nil
        if state == .locating { state = .idle }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if manager.authorizationStatus == .authorizedAlways || manager.authorizationStatus == .authorizedWhenInUse {
            requestLocation()
        } else if manager.authorizationStatus == .denied || manager.authorizationStatus == .restricted {
            state = .denied
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last, location.horizontalAccuracy >= 0 else {
            state = .unavailable
            return
        }
        manager.stopUpdatingLocation()
        Task { await reverseGeocode(location) }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let nsError = error as NSError
        if nsError.domain == kCLErrorDomain,
           nsError.code == CLError.locationUnknown.rawValue,
           locationUnknownRetryCount == 0 {
            locationUnknownRetryCount += 1
            manager.requestLocation()
            return
        }
        state = .unavailable
    }

    private func requestLocation() {
        state = .locating
        manager.requestLocation()
    }

    private func reverseGeocode(_ location: CLLocation) async {
        guard let request = MKReverseGeocodingRequest(location: location) else {
            useCoordinateFallback(location)
            return
        }
        reverseRequest?.cancel()
        reverseRequest = request
        do {
            guard let placemark = try await request.mapItems.first?.placemark else {
                guard reverseRequest === request else { return }
                useCoordinateFallback(location)
                return
            }
            guard reverseRequest === request else { return }
            suggestion = RecordLocationFormatter.location(from: placemark, fallbackName: "当前位置")
            reverseRequest = nil
            state = .idle
        } catch {
            guard reverseRequest === request else { return }
            useCoordinateFallback(location)
        }
    }

    private func useCoordinateFallback(_ location: CLLocation) {
        reverseRequest = nil
        suggestion = RecordLocation(
            name: "当前位置",
            latitude: location.coordinate.latitude,
            longitude: location.coordinate.longitude
        )
        state = .idle
    }
}
