import MapKit
import SwiftUI

struct RecordLocationEditorView: View {
    @Environment(\.dismiss) private var dismiss

    let initialLocation: RecordLocation?
    let onSave: (RecordLocation) -> Void

    @State private var query = ""
    @State private var results: [MKMapItem] = []
    @State private var selectedLocation: RecordLocation?
    @State private var isSearching = false
    @State private var errorMessage: String?

    init(initialLocation: RecordLocation?, onSave: @escaping (RecordLocation) -> Void) {
        self.initialLocation = initialLocation
        self.onSave = onSave
        _selectedLocation = State(initialValue: initialLocation)
    }

    var body: some View {
        NavigationStack {
            Form {
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

                if let selectedLocation {
                    Section("已选地点") {
                        Text(selectedLocation.name)
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
        let name = item.name ?? item.placemark.title ?? ""
        guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        selectedLocation = RecordLocation(name: name, latitude: coordinate.latitude, longitude: coordinate.longitude)
        results = []
    }

    private func save() {
        guard let selectedLocation else { return }
        onSave(selectedLocation)
        dismiss()
    }
}
