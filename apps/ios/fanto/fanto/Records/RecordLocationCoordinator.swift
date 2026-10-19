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
    private var wantsLocation = false
    private var requestGeneration = UUID()
    var authorizationStatus: CLAuthorizationStatus { manager.authorizationStatus }
    var locationServicesEnabled: Bool { CLLocationManager.locationServicesEnabled() }

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    func start(requestAuthorization: Bool = true) {
        stop()
        wantsLocation = true
        suggestion = nil
        locationUnknownRetryCount = 0
        guard CLLocationManager.locationServicesEnabled() else {
            state = .unavailable
            return
        }
        switch manager.authorizationStatus {
        case .notDetermined:
            if requestAuthorization { manager.requestWhenInUseAuthorization() }
            else { wantsLocation = false; state = .idle }
        case .authorizedAlways, .authorizedWhenInUse:
            requestLocation()
        case .denied, .restricted:
            state = .denied
        @unknown default:
            state = .unavailable
        }
    }

    func stop() {
        requestGeneration = UUID()
        wantsLocation = false
        manager.stopUpdatingLocation()
        reverseRequest?.cancel()
        reverseRequest = nil
        if state == .locating { state = .idle }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard wantsLocation else { return }
        if manager.authorizationStatus == .authorizedAlways || manager.authorizationStatus == .authorizedWhenInUse {
            requestLocation()
        } else if manager.authorizationStatus == .denied || manager.authorizationStatus == .restricted {
            state = .denied
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard wantsLocation else { return }
        guard let location = locations.last, location.horizontalAccuracy >= 0 else {
            state = .unavailable
            return
        }
        manager.stopUpdatingLocation()
        let generation = requestGeneration
        Task {
            guard requestGeneration == generation, wantsLocation else { return }
            await reverseGeocode(location)
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        guard wantsLocation else { return }
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
        guard wantsLocation, state != .locating else { return }
        state = .locating
        manager.requestLocation()
    }

    private func reverseGeocode(_ location: CLLocation) async {
        guard wantsLocation else { return }
        guard let request = MKReverseGeocodingRequest(location: location) else {
            useCoordinateFallback(location)
            return
        }
        reverseRequest?.cancel()
        reverseRequest = request
        do {
            guard let item = try await request.mapItems.first else {
                guard reverseRequest === request else { return }
                useCoordinateFallback(location)
                return
            }
            guard reverseRequest === request else { return }
            wantsLocation = false
            suggestion = RecordLocationFormatter.location(from: item, coordinate: location.coordinate, fallbackName: "当前位置")
            reverseRequest = nil
            state = .idle
        } catch {
            guard reverseRequest === request else { return }
            useCoordinateFallback(location)
        }
    }

    private func useCoordinateFallback(_ location: CLLocation) {
        wantsLocation = false
        reverseRequest = nil
        suggestion = RecordLocation(
            name: "当前位置",
            latitude: location.coordinate.latitude,
            longitude: location.coordinate.longitude
        )
        state = .idle
    }
}
