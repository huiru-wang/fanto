import MapKit
import SwiftUI

struct RecordLocationEditorView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase

    let initialLocation: RecordLocation?
    let onSave: (RecordLocation) -> Void

    @State private var query = ""
    @State private var results: [MKMapItem] = []
    @State private var selectedLocation: RecordLocation?
    @State private var selectedCoordinate: CLLocationCoordinate2D?
    @State private var cameraPosition: MapCameraPosition
    @State private var showingLocationSettings = false
    @State private var requestingCurrentLocation = false
    @State private var isSearching = false
    @State private var isResolvingMapPoint = false
    @State private var errorMessage: String?
    @StateObject private var locationCoordinator = RecordLocationCoordinator()
    @FocusState private var searchFocused: Bool

    @State private var reverseRequest: MKReverseGeocodingRequest?

    @MainActor init(initialLocation: RecordLocation?, onSave: @escaping (RecordLocation) -> Void) {
        self.initialLocation = initialLocation
        self.onSave = onSave
        _selectedLocation = State(initialValue: initialLocation)
        _selectedCoordinate = State(initialValue: initialLocation.map {
            CLLocationCoordinate2D(latitude: $0.latitude, longitude: $0.longitude)
        })
        _cameraPosition = State(initialValue: initialLocation.map(Self.cameraPosition(for:)) ?? .automatic)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HStack(spacing: 10) {
                        Image(systemName: "magnifyingglass")
                            .foregroundStyle(.secondary)
                        TextField("搜索地点或地址", text: $query)
                            .focused($searchFocused)
                            .submitLabel(.search)
                            .onSubmit { searchFocused = false; Task { await search() } }
                        if !query.isEmpty {
                            Button("清除搜索", systemImage: "xmark.circle.fill") { query = "" }
                                .labelStyle(.iconOnly)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.horizontal, 14)
                    .frame(minHeight: 48)
                    .background(.quaternary.opacity(0.5), in: .rect(cornerRadius: 14))

                    MapReader { proxy in
                        Map(position: $cameraPosition) {
                            if locationCoordinator.authorizationStatus == .authorizedAlways || locationCoordinator.authorizationStatus == .authorizedWhenInUse {
                                UserAnnotation()
                            }
                            if let selectedCoordinate {
                                Marker(selectedLocation?.name ?? "地图选点", coordinate: selectedCoordinate)
                            }
                        }
                        .mapControls { MapCompass() }
                        .onTapGesture { screenPoint in
                            guard let coordinate = proxy.convert(screenPoint, from: .local) else { return }
                            searchFocused = false
                            Task { await selectMapPoint(coordinate) }
                        }
                    }
                    .frame(height: 330)
                    .clipShape(.rect(cornerRadius: 18))
                    .overlay(alignment: .bottom) {
                        Button(action: requestCurrentLocation) {
                            Label {
                                Text("当前位置")
                            } icon: {
                                if locationCoordinator.state == .locating {
                                    ProgressView().controlSize(.mini)
                                } else {
                                    Image(systemName: "location.fill")
                                }
                            }
                            .font(.subheadline.weight(.medium))
                            .frame(minHeight: 44)
                            .padding(.horizontal, 14)
                        }
                        .buttonStyle(.glass)
                        .buttonBorderShape(.capsule)
                        .disabled(locationCoordinator.state == .locating)
                        .accessibilityHint("定位并选择当前位置，地图其他区域仍可轻点选点")
                        .padding(.bottom, 12)
                    }
                    .accessibilityLabel("地点地图")
                    .accessibilityHint("轻点地图选点，也可以使用搜索结果")

                    if let selectedLocation {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("已选地点")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            HStack(spacing: 12) {
                                Image(systemName: "mappin")
                                    .foregroundStyle(.tint)
                                    .frame(width: 36, height: 36)
                                    .background(Color.accentColor.opacity(0.1), in: Circle())
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(selectedLocation.name).font(.subheadline.weight(.semibold))
                                    let administrativeText = RecordLocationFormatter.detailText(for: selectedLocation)
                                    if !administrativeText.isEmpty {
                                        Text(administrativeText)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                                Spacer(minLength: 0)
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundStyle(.tint)
                                    .accessibilityHidden(true)
                            }
                            .padding(14)
                            .background(.quaternary.opacity(0.4), in: .rect(cornerRadius: 16))
                        }
                    }

                    if !query.isEmpty {
                        HStack {
                            Text("搜索结果")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            if isSearching { ProgressView().controlSize(.mini) }
                        }
                        ForEach(results, id: \.self) { item in
                            Button {
                                searchFocused = false
                                apply(item)
                            } label: {
                                HStack(spacing: 12) {
                                    Image(systemName: "mappin.circle")
                                        .font(.title3)
                                        .foregroundStyle(.secondary)
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(location(for: item).name).foregroundStyle(.primary)
                                        let administrativeText = RecordLocationFormatter.administrativeText(for: location(for: item))
                                        if !administrativeText.isEmpty {
                                            Text(administrativeText)
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                    Spacer(minLength: 0)
                                    Image(systemName: "chevron.right")
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(.tertiary)
                                }
                                .frame(minHeight: 56)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            Divider()
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 12)
                .padding(.bottom, 32)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(.background)
            .navigationTitle("编辑地点")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("返回", systemImage: "chevron.left") { dismiss() }.labelStyle(.iconOnly)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("完成", systemImage: "checkmark", action: save).labelStyle(.iconOnly)
                        .disabled(selectedLocation == nil || isResolvingMapPoint || locationCoordinator.state == .locating)
                }
            }
            .alert("地点暂不可用", isPresented: Binding(
                get: { errorMessage != nil },
                set: { if !$0 { errorMessage = nil } }
            )) {
                Button("好", role: .cancel) { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "请检查输入。")
            }
            .alert("前往设置开启定位？", isPresented: $showingLocationSettings) {
                Button("取消", role: .cancel) { }
                Button("前往设置") {
                    guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
                    UIApplication.shared.open(url)
                }
            } message: {
                Text(locationCoordinator.locationServicesEnabled ? "开启后可自动添加当前位置。" : "请在系统设置的隐私与安全性中开启定位服务，也可以继续搜索地点。")
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active, requestingCurrentLocation { locationCoordinator.start(requestAuthorization: false) }
            }
            .onChange(of: locationCoordinator.suggestion) { _, suggestion in
                guard requestingCurrentLocation, let suggestion else { return }
                requestingCurrentLocation = false
                select(suggestion)
            }
            .onChange(of: locationCoordinator.state) { _, state in
                if requestingCurrentLocation, state == .unavailable {
                    requestingCurrentLocation = false
                    errorMessage = "暂时无法获取当前位置，请重试，或搜索地点、在地图上选点。"
                }
            }
            .task(id: query) {
                guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                    results = []
                    return
                }
                try? await Task.sleep(for: .milliseconds(350))
                if !Task.isCancelled { await search() }
            }
            .onDisappear {
                reverseRequest?.cancel()
                reverseRequest = nil
                locationCoordinator.stop()
            }
        }
        .tint(.primary)
    }

    private func search() async {
        isSearching = true
        errorMessage = nil
        defer { isSearching = false }
        let searchedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !searchedQuery.isEmpty else { results = []; return }
        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = searchedQuery
        request.resultTypes = [.address, .pointOfInterest]
        do {
            let matches = try await MKLocalSearch(request: request).start().mapItems
            guard !Task.isCancelled, query.trimmingCharacters(in: .whitespacesAndNewlines) == searchedQuery else { return }
            results = matches
        } catch {
            if !Task.isCancelled { errorMessage = "暂时无法搜索地点，请稍后重试。" }
        }
    }

    private func requestCurrentLocation() {
        reverseRequest?.cancel()
        reverseRequest = nil
        isResolvingMapPoint = false
        searchFocused = false
        requestingCurrentLocation = true
        guard locationCoordinator.locationServicesEnabled else { showingLocationSettings = true; return }
        switch locationCoordinator.authorizationStatus {
        case .denied: showingLocationSettings = true
        case .restricted:
            requestingCurrentLocation = false
            errorMessage = "当前设备限制了定位权限，你仍可搜索地点或在地图上选点。"
        default: locationCoordinator.start()
        }
    }

    private func apply(_ item: MKMapItem) {
        requestingCurrentLocation = false
        locationCoordinator.stop()
        reverseRequest?.cancel()
        reverseRequest = nil
        isResolvingMapPoint = false
        let coordinate = item.location.coordinate
        guard CLLocationCoordinate2DIsValid(coordinate) else { return }
        select(location(for: item))
        results = []
    }

    private func selectMapPoint(_ coordinate: CLLocationCoordinate2D) async {
        requestingCurrentLocation = false
        locationCoordinator.stop()
        guard CLLocationCoordinate2DIsValid(coordinate) else { return }
        reverseRequest?.cancel()
        reverseRequest = nil
        selectedLocation = nil
        selectedCoordinate = coordinate
        let fallback = RecordLocation(name: "地图选点", latitude: coordinate.latitude, longitude: coordinate.longitude)
        let location = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
        guard let request = MKReverseGeocodingRequest(location: location) else {
            isResolvingMapPoint = false
            select(fallback)
            return
        }
        reverseRequest = request
        isResolvingMapPoint = true
        defer {
            // An older cancelled request must not clear the new selection's progress.
            if reverseRequest === request {
                reverseRequest = nil
                isResolvingMapPoint = false
            }
        }
        do {
            let item = try await request.mapItems.first
            guard reverseRequest === request else { return }
            select(item.map {
                RecordLocationFormatter.location(from: $0, coordinate: coordinate, fallbackName: "地图选点")
            } ?? fallback)
        } catch {
            guard reverseRequest === request else { return }
            select(fallback)
        }
    }

    private func select(_ location: RecordLocation) {
        selectedLocation = location
        selectedCoordinate = coordinate(for: location)
        cameraPosition = Self.cameraPosition(for: location)
    }

    private func location(for item: MKMapItem) -> RecordLocation {
        RecordLocationFormatter.location(
            from: item,
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
