import PhotosUI
import SwiftUI

struct RecordComposerView: View {
    @Environment(FantoStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase

    let didSave: (Date) -> Void

    @State private var text = ""
    @State private var eventAt = Date.now
    @State private var images: [DraftRecordImage] = []
    @State private var selectedPhotoItems: [PhotosPickerItem] = []
    @State private var isImportingPhotos = false
    @State private var isSaving = false
    @State private var showingPhotoPicker = false
    @State private var showingDatePicker = false
    @State private var showingLocationEditor = false
    @State private var showingError = false
    @State private var errorMessage = ""
    @State private var location: RecordLocation?
    @State private var acceptsLocationSuggestion = true
    @State private var draftScope: AccountCacheScope?
    @State private var draftLoaded = false
    @State private var didSubmit = false
    @StateObject private var locationCoordinator = RecordLocationCoordinator()
    @FocusState private var isEditingText: Bool

    private let maximumPhotoCount = 5
    private var isBusy: Bool { isSaving || isImportingPhotos || !draftLoaded }
    private var canSave: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !images.isEmpty
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    textEditor
                    photoSection
                    RecordComposerLocationView(
                        location: location,
                        state: locationCoordinator.state,
                        edit: editLocation,
                        remove: removeLocation
                    )
                }
                .padding(.horizontal, 20)
                .padding(.top, 28)
                .padding(.bottom, 32)
                .allowsHitTesting(!isBusy)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(.background)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("返回", systemImage: "chevron.left") {
                        guard !isSaving else { return }
                        dismiss()
                    }
                    .labelStyle(.iconOnly)
                    .allowsHitTesting(!isSaving)
                }
                ToolbarItem(placement: .principal) {
                    Button {
                        guard !isBusy else { return }
                        isEditingText = false
                        showingDatePicker = true
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "calendar")
                                .foregroundStyle(.tint)
                            VStack(spacing: 1) {
                                Text(dateText)
                                Text(timeText)
                            }
                            .foregroundStyle(.primary)
                            Image(systemName: "chevron.down")
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(.secondary)
                        }
                        .font(.subheadline.weight(.medium))
                        .padding(.horizontal, 12)
                        .frame(minHeight: 44)
                    }
                    .buttonStyle(.glass)
                    .allowsHitTesting(!isBusy)
                    .accessibilityLabel("记录日期与时间")
                    .accessibilityValue(eventAt.formatted(date: .complete, time: .shortened))
                    .accessibilityHint("选择记录发生的日期和时间")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        isEditingText = false
                        Task { await save() }
                    } label: {
                        if isSaving {
                            ProgressView().accessibilityLabel("正在保存记录")
                        } else {
                            Image(systemName: "checkmark")
                        }
                    }
                    .disabled(!canSave || isBusy)
                    .accessibilityLabel(isSaving ? "保存中" : "保存")
                }
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("完成") { isEditingText = false }
                }
            }
            .photosPicker(
                isPresented: $showingPhotoPicker,
                selection: $selectedPhotoItems,
                maxSelectionCount: max(1, maximumPhotoCount - images.count),
                selectionBehavior: .ordered,
                matching: .images
            )
            .task(id: selectedPhotoItems) {
                guard !selectedPhotoItems.isEmpty else { return }
                await appendPhotos(selectedPhotoItems)
            }
            .sheet(isPresented: $showingDatePicker) {
                RecordDatePickerView(date: eventAt) { eventAt = $0 }
            }
            .sheet(isPresented: $showingLocationEditor) {
                RecordLocationEditorView(initialLocation: location) {
                    acceptsLocationSuggestion = false
                    location = $0
                }
            }
            .alert("无法完成操作", isPresented: $showingError) {
                Button("好", role: .cancel) {}
            } message: {
                Text(errorMessage)
            }
            .interactiveDismissDisabled(isSaving)
            .onChange(of: locationCoordinator.suggestion) { _, suggestion in
                guard acceptsLocationSuggestion, let suggestion else { return }
                location = suggestion
            }
            .task { await restoreDraft() }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active {
                    if draftLoaded, acceptsLocationSuggestion, location == nil {
                        locationCoordinator.start(requestAuthorization: false)
                    }
                } else { persistDraft() }
            }
            .onDisappear {
                locationCoordinator.stop()
                persistDraft()
            }
        }
        .tint(.primary)
    }

    private var textEditor: some View {
        TextField("记录此刻的想法…", text: $text, axis: .vertical)
            .tint(FantoTheme.accent)
            .font(.body)
            .lineSpacing(6)
            .lineLimit(3...)
            .focused($isEditingText)
            .accessibilityLabel("记录内容")
    }

    private var photoSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            ScrollView(.horizontal) {
                HStack(spacing: 10) {
                    ForEach(images) { image in
                        Image(uiImage: image.preview)
                            .resizable()
                            .scaledToFill()
                            .frame(width: 96, height: 112)
                            .clipShape(.rect(cornerRadius: 14))
                            .accessibilityLabel("已选图片")
                            .overlay(alignment: .topTrailing) {
                                Button("移除图片", systemImage: "xmark") {
                                    images.removeAll { $0.id == image.id }
                                }
                                .labelStyle(.iconOnly)
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.white)
                                .frame(width: 28, height: 28)
                                .background(.black.opacity(0.45), in: Circle())
                                .frame(width: 44, height: 44)
                                .buttonStyle(.plain)
                            }
                    }
                    if images.count < maximumPhotoCount {
                        Button {
                            isEditingText = false
                            showingPhotoPicker = true
                        } label: {
                            ZStack {
                                RoundedRectangle(cornerRadius: 14)
                                    .fill(.quaternary.opacity(0.5))
                                if isImportingPhotos {
                                    ProgressView()
                                } else {
                                    Image(systemName: "plus")
                                        .font(.title.weight(.light))
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .frame(width: 96, height: 112)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("添加图片")
                        .accessibilityHint("最多添加五张图片")
                    }
                }
            }
            .scrollIndicators(.hidden)
            Text("\(images.count) / \(maximumPhotoCount)")
                .font(.caption)
                .foregroundStyle(.secondary)
                .accessibilityLabel("已添加 \(images.count) 张图片，最多 \(maximumPhotoCount) 张")
        }
    }

    private func restoreDraft() async {
        guard !draftLoaded else { return }
        guard let scope = AccountCache.shared.scope else { return }
        draftScope = scope
        do {
            let draft = try await RecordDraftPersistence.shared.load(scope: scope)
            guard !Task.isCancelled, AccountCache.shared.scope == scope else { return }
            if let draft {
                let restoredImages = try draft.photos.map { try DraftRecordImage(restoring: $0) }
                text = draft.text; eventAt = draft.eventAt; images = restoredImages; location = draft.location
                acceptsLocationSuggestion = draft.acceptsLocationSuggestion && draft.location == nil
            }
            draftLoaded = true
            if acceptsLocationSuggestion, location == nil { locationCoordinator.start(requestAuthorization: false) }
        } catch {
            if !(error is CancellationError) { showError("草稿读取失败，请返回后重试，原草稿已保留。") }
        }
    }

    private func persistDraft() {
        guard draftLoaded, !didSubmit, let draftScope, AccountCache.shared.scope == draftScope else { return }
        let draft = RecordComposerDraft(text: text, eventAt: eventAt, location: location,
            acceptsLocationSuggestion: acceptsLocationSuggestion,
            photos: images.map { RecordDraftPhoto(id: $0.id, data: $0.data, width: $0.width, height: $0.height, mediaID: $0.mediaID) })
        RecordDraftPersistence.shared.save(draft, scope: draftScope)
    }

    private func editLocation() {
        guard !isBusy else { return }
        isEditingText = false
        locationCoordinator.stop()
        showingLocationEditor = true
    }

    private func removeLocation() {
        guard !isBusy else { return }
        acceptsLocationSuggestion = false
        location = nil
        locationCoordinator.stop()
    }

    private func appendPhotos(_ items: [PhotosPickerItem]) async {
        isImportingPhotos = true
        defer {
            isImportingPhotos = false
            selectedPhotoItems = []
        }
        var failedCount = 0
        for item in items.prefix(maximumPhotoCount - images.count) {
            do {
                guard let data = try await item.loadTransferable(type: Data.self) else {
                    failedCount += 1
                    continue
                }
                try Task.checkCancellation()
                let image = try DraftRecordImage(data: data)
                images.append(image)
            } catch is CancellationError {
                return
            } catch {
                failedCount += 1
            }
        }
        if failedCount > 0 {
            showError("有 \(failedCount) 张图片读取失败，请重新选择。")
        }
    }

    private func save() async {
        guard canSave, !isBusy, let draftScope, AccountCache.shared.scope == draftScope else { return }
        isSaving = true
        acceptsLocationSuggestion = false
        locationCoordinator.stop()
        defer { isSaving = false }
        do {
            var mediaIds: [String] = []
            // Upload two at a time, keeping original order and resumable state.
            for index in stride(from: 0, to: images.count, by: 2) {
                if index + 1 < images.count {
                    async let first = uploadImage(at: index)
                    async let second = uploadImage(at: index + 1)
                    let (firstID, secondID) = try await (first, second)
                    mediaIds.append(contentsOf: [firstID, secondID])
                } else {
                    mediaIds.append(try await uploadImage(at: index))
                }
            }
            guard AccountCache.shared.scope == draftScope else { throw CancellationError() }
            let created = try await RecordWriteAPIClient.shared.createRecord(
                text: text.trimmingCharacters(in: .whitespacesAndNewlines),
                mediaIds: mediaIds,
                location: location,
                eventAt: eventAt
            )
            guard AccountCache.shared.scope == draftScope else { throw CancellationError() }
            didSubmit = true
            try? await RecordDraftPersistence.shared.clear(scope: draftScope)
            store.insertCreatedRecord(created)
            didSave(eventAt)
            dismiss()
        } catch {
            persistDraft()
            showError("保存失败，请重试")
        }
    }

    private func uploadImage(at index: Int) async throws -> String {
        if let mediaID = images[index].mediaID { return mediaID }
        let image = images[index]
        let mediaID = try await RecordWriteAPIClient.shared.upload(
            DraftMediaUpload(
                data: image.data,
                mimeType: "image/jpeg",
                capture: MediaCapturePayload(width: image.width, height: image.height)
            ),
            progress: image.uploadProgress,
            onProgress: { images[index].uploadProgress = $0 }
        )
        images[index].mediaID = mediaID
        return mediaID
    }

    private func showError(_ message: String) {
        errorMessage = message
        showingError = true
    }

    private var dateText: String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.dateFormat = "M月d日 EEE"
        return formatter.string(from: eventAt)
    }

    private var timeText: String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: eventAt)
    }
}

#Preview {
    RecordComposerView { _ in }.environment(FantoStore.preview)
}
