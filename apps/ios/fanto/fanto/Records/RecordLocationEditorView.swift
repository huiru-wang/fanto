import MapKit
import SwiftUI

struct RecordLocationEditorView: View {
    @Environment(\.dismiss) private var dismiss

    let initialLocation: RecordLocation?
    let onSave: (RecordLocation) -> Void

    @State private var query = ""
    @State private var results: [MKMapItem] = []
    @State private var selectedLocation: RecordLocation?
    @State private var cameraPosition: MapCameraPosition
    @State private var isSearching = false
    @State private var isResolvingMapPoint = false
    @State private var errorMessage: String?
    @StateObject private var locationCoordinator = RecordLocationCoordinator()

    private let geocoder = CLGeocoder()

    init(initialLocation: RecordLocation?, onSave: @escaping (RecordLocation) -> Void) {
        self.initialLocation = initialLocation
        self.onSave = onSave
        _selectedLocation = State(initialValue: initialLocation)
        _cameraPosition = State(initialValue: initialLocation.map(Self.cameraPosition(for:)) ?? .automatic)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    MapReader { proxy in
                        Map(position: $cameraPosition) {
                            UserAnnotation()
                            if let selectedLocation {
                                Marker(selectedLocation.name, coordinate: coordinate(for: selectedLocation))
                            }
                        }
                        .onTapGesture { screenPoint in
                            guard let coordinate = proxy.convert(screenPoint, from: .local) else { return }
                            Task { await selectMapPoint(coordinate) }
                        }
                    }
                    .frame(height: 260)
                    .clipShape(RoundedRectangle(cornerRadius: 12))

                    Button {
                        locationCoordinator.start()
                    } label: {
                        Label(
                            locationCoordinator.state == .locating ? "正在获取当前位置" : "使用当前位置",
                            systemImage: "location.fill"
                        )
                    }
                    .disabled(locationCoordinator.state == .locating)

                    if isResolvingMapPoint {
                        ProgressView("正在确认地图位置")
                    } else {
                        Text("轻点地图可选取位置")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Section("编辑地点") {
                    HStack {
                        TextField("地点、地址或 POI", text: $query)
                            .textInputAutocapitalization(.never)
                            .submitLabel(.search)
                            .onSubmit { Task { await search() } }
                        Button("搜索") { Task { await search() } }
                            .disabled(query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSearching)
                    }

                    if isSearching {
                        ProgressView("正在搜索")
                    }

                    ForEach(results, id: \.self) { item in
                        Button {
                            apply(item)
                        } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(location(for: item).name)
                                    .foregroundStyle(.primary)
                                let administrativeText = RecordLocationFormatter.administrativeText(for: location(for: item))
                                if !administrativeText.isEmpty {
                                    Text(administrativeText)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }

                if let selectedLocation {
                    Section("已选地点") {
                        Text(selectedLocation.name)
                        let administrativeText = RecordLocationFormatter.administrativeText(for: selectedLocation)
                        if !administrativeText.isEmpty {
                            Text(administrativeText)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Text(String(format: "%.6f, %.6f", selectedLocation.latitude, selectedLocation.longitude))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("编辑地点")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成", action: save)
                        .disabled(selectedLocation == nil)
                }
            }
            .alert("无法保存地点", isPresented: Binding(
                get: { errorMessage != nil },
                set: { if !$0 { errorMessage = nil } }
            )) {
                Button("好", role: .cancel) { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "请检查输入。")
            }
            .onChange(of: locationCoordinator.suggestion) { _, suggestion in
                guard let suggestion else { return }
                select(suggestion)
            }
        }
    }

    private func search() async {
        isSearching = true
        errorMessage = nil
        defer { isSearching = false }
        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = query
        request.resultTypes = [.address, .pointOfInterest]
        do {
            results = try await MKLocalSearch(request: request).start().mapItems
        } catch {
            errorMessage = "暂时无法搜索地点，请稍后重试。"
        }
    }

    private func apply(_ item: MKMapItem) {
        let coordinate = item.placemark.coordinate
        guard CLLocationCoordinate2DIsValid(coordinate) else { return }
        select(location(for: item))
        results = []
    }

    private func selectMapPoint(_ coordinate: CLLocationCoordinate2D) async {
        guard CLLocationCoordinate2DIsValid(coordinate) else { return }
        isResolvingMapPoint = true
        defer { isResolvingMapPoint = false }

        let location = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
        do {
            let placemark = try await geocoder.reverseGeocodeLocation(location).first
            if let placemark {
                select(RecordLocationFormatter.location(from: placemark, fallbackName: "地图选点"))
            } else {
                select(RecordLocation(name: "地图选点", latitude: coordinate.latitude, longitude: coordinate.longitude))
            }
        } catch {
            select(RecordLocation(name: "地图选点", latitude: coordinate.latitude, longitude: coordinate.longitude))
        }
    }

    private func select(_ location: RecordLocation) {
        selectedLocation = location
        cameraPosition = Self.cameraPosition(for: location)
    }

    private func location(for item: MKMapItem) -> RecordLocation {
        RecordLocationFormatter.location(
            from: item.placemark,
            name: item.name,
            fallbackName: "未命名地点"
        )
    }

    private func coordinate(for location: RecordLocation) -> CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: location.latitude, longitude: location.longitude)
    }

    private static func cameraPosition(for location: RecordLocation) -> MapCameraPosition {
        .region(MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: location.latitude, longitude: location.longitude),
            span: MKCoordinateSpan(latitudeDelta: 0.02, longitudeDelta: 0.02)
        ))
    }

    private func save() {
        guard let selectedLocation else { return }
        onSave(selectedLocation)
        dismiss()
    }
}
