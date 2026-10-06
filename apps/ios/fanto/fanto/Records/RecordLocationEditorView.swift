import MapKit
import SwiftUI

struct RecordLocationEditorView: View {
    @Environment(\.dismiss) private var dismiss

    let initialLocation: RecordLocation?
    let onSave: (RecordLocation) -> Void

    @State private var name: String
    @State private var latitude: String
    @State private var longitude: String
    @State private var query = ""
    @State private var results: [MKMapItem] = []
    @State private var isSearching = false
    @State private var errorMessage: String?

    init(initialLocation: RecordLocation?, onSave: @escaping (RecordLocation) -> Void) {
        self.initialLocation = initialLocation
        self.onSave = onSave
        _name = State(initialValue: initialLocation?.name ?? "")
        _latitude = State(initialValue: initialLocation.map { String(format: "%.6f", $0.latitude) } ?? "")
        _longitude = State(initialValue: initialLocation.map { String(format: "%.6f", $0.longitude) } ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("搜索地点") {
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
                                Text(item.name ?? "未命名地点")
                                    .foregroundStyle(.primary)
                                if let title = item.placemark.title, !title.isEmpty {
                                    Text(title)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }

                Section("地点详情") {
                    TextField("地点名称", text: $name)
                    TextField("纬度", text: $latitude)
                        .keyboardType(.decimalPad)
                    TextField("经度", text: $longitude)
                        .keyboardType(.decimalPad)
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
        }
    }

    private func search() async {
        isSearching = true
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
        name = item.name ?? item.placemark.title ?? ""
        latitude = String(format: "%.6f", coordinate.latitude)
        longitude = String(format: "%.6f", coordinate.longitude)
        results = []
    }

    private func save() {
        let cleanName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanName.isEmpty,
              let parsedLatitude = Double(latitude),
              let parsedLongitude = Double(longitude),
              (-90 ... 90).contains(parsedLatitude),
              (-180 ... 180).contains(parsedLongitude)
        else {
            errorMessage = "请输入地点名称和有效的经纬度。"
            return
        }
        onSave(RecordLocation(name: cleanName, latitude: parsedLatitude, longitude: parsedLongitude))
        dismiss()
    }
}
