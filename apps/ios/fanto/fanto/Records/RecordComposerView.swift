import AVFAudio
import Combine
import PhotosUI
import SwiftUI
import UIKit

struct RecordComposerView: View {
    @Environment(FantoStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    let didSave: (Date) -> Void

    @State private var text = ""
    @State private var eventAt = Date.now
    @State private var images: [DraftRecordImage] = []
    @State private var selectedPhotoItems: [PhotosPickerItem] = []
    @State private var audio: DraftRecordAudio?
    @State private var audioRecorder: AVAudioRecorder?
    @State private var audioPlayer: AVAudioPlayer?
    @State private var recordingStartedAt: Date?
    @State private var recordingDuration: TimeInterval = 0
    @State private var isSaving = false
    @State private var showingPhotoPicker = false
    @State private var showingDatePicker = false
    @State private var showingLocationEditor = false
    @State private var errorMessage: String?
    @State private var location: RecordLocation?
    @State private var locationEnabled = true
    @StateObject private var locationCoordinator = RecordLocationCoordinator()

    private let recordingTimer = Timer.publish(every: 0.2, on: .main, in: .common).autoconnect()

    private var attachmentCount: Int {
        images.count + (audio == nil ? 0 : 1)
    }

    private var canSave: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !images.isEmpty || audio != nil
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    dateCard
                    locationCard
                    textCard
                    photoSection
                    audioSection
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, 28)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Color(uiColor: .systemBackground))
            .navigationTitle("新记录")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") {
                        stopRecording(discard: true)
                        dismiss()
                    }
                    .disabled(isSaving)
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "保存中" : "保存") {
                        Task { await save() }
                    }
                    .disabled(!canSave || isSaving || audioRecorder?.isRecording == true)
                    .fontWeight(.semibold)
                }
            }
            .photosPicker(
                isPresented: $showingPhotoPicker,
                selection: $selectedPhotoItems,
                maxSelectionCount: max(1, 4 - attachmentCount),
                matching: .images
            )
            .onChange(of: selectedPhotoItems) { _, items in
                guard !items.isEmpty else { return }
                Task { await appendPhotos(items) }
            }
            .sheet(isPresented: $showingDatePicker) {
                NavigationStack {
                    DatePicker("记录日期", selection: $eventAt, displayedComponents: .date)
                        .datePickerStyle(.graphical)
                        .padding()
                        .navigationTitle("选择日期")
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar {
                            ToolbarItem(placement: .confirmationAction) {
                                Button("完成") { showingDatePicker = false }
                            }
                        }
                }
                .presentationDetents([.medium])
            }
            .sheet(isPresented: $showingLocationEditor) {
                RecordLocationEditorView(initialLocation: location) { selectedLocation in
                    locationEnabled = true
                    location = selectedLocation
                }
            }
            .alert("无法完成操作", isPresented: Binding(
                get: { errorMessage != nil },
                set: { if !$0 { errorMessage = nil } }
            )) {
                Button("好", role: .cancel) { errorMessage = nil }
            } message: {
                Text(errorMessage ?? "请稍后重试。")
            }
            .onReceive(recordingTimer) { now in
                guard let startedAt = recordingStartedAt, audioRecorder?.isRecording == true else { return }
                recordingDuration = now.timeIntervalSince(startedAt)
            }
            .onChange(of: locationCoordinator.suggestion) { _, suggestion in
                guard locationEnabled, let suggestion else { return }
                location = suggestion
            }
            .onAppear {
                if locationEnabled { locationCoordinator.start() }
            }
            .onDisappear {
                stopRecording(discard: true)
                audioPlayer?.stop()
                locationCoordinator.stop()
            }
        }
    }

    private var dateCard: some View {
        Button {
            showingDatePicker = true
        } label: {
            HStack(spacing: 15) {
                Image(systemName: "calendar")
                    .font(.system(size: 20, weight: .medium))
                    .foregroundStyle(.primary)
                    .frame(width: 28)

                Text(dateText)
                    .font(.system(size: 17, weight: .regular))
                    .foregroundStyle(.primary)

                Image(systemName: "chevron.right")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.primary)

                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16)
            .frame(height: 60)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .background(cardBackground)
    }

    @ViewBuilder
    private var locationCard: some View {
        HStack(spacing: 15) {
            Image(systemName: "location")
                .font(.system(size: 20, weight: .medium))
                .foregroundStyle(FantoTheme.accent)
                .frame(width: 28)

            VStack(alignment: .leading, spacing: 3) {
                if let location {
                    Text(location.name)
                        .font(.system(size: 17))
                        .lineLimit(1)
                    Text(String(format: "%.6f, %.6f", location.latitude, location.longitude))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    switch locationCoordinator.state {
                    case .locating:
                        Text("正在获取当前位置")
                            .font(.system(size: 17))
                        Text("可继续编辑记录，不必等待")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    case .denied:
                        Text("定位未开启")
                            .font(.system(size: 17))
                        Text("可在设置中允许访问位置，或手动添加地点")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    case .unavailable:
                        Text("未能获取当前位置")
                            .font(.system(size: 17))
                        Text("可重试或手动添加地点")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    case .idle:
                        Text("未添加地点")
                            .font(.system(size: 17))
                    }
                }
            }

            Spacer(minLength: 8)

            if location != nil {
                Button("编辑") {
                    locationCoordinator.stop()
                    showingLocationEditor = true
                }
                .font(.subheadline.weight(.medium))
                Button {
                    locationEnabled = false
                    location = nil
                    locationCoordinator.stop()
                } label: {
                    Image(systemName: "xmark")
                        .frame(width: 30, height: 30)
                }
                .accessibilityLabel("移除地点")
            } else if locationCoordinator.state == .denied {
                Button("去设置") { openLocationSettings() }
                    .font(.subheadline.weight(.medium))
                Button("手动添加") {
                    locationCoordinator.stop()
                    showingLocationEditor = true
                }
                .font(.subheadline.weight(.medium))
            } else {
                if locationCoordinator.state == .unavailable {
                    Button("重试") {
                        locationEnabled = true
                        locationCoordinator.start()
                    }
                }
                if locationCoordinator.state != .locating {
                    Button("手动添加") {
                        locationCoordinator.stop()
                        showingLocationEditor = true
                    }
                    .font(.subheadline.weight(.medium))
                }
                if locationCoordinator.state == .idle {
                    Button("定位") {
                        locationEnabled = true
                        locationCoordinator.start()
                    }
                    .font(.subheadline.weight(.medium))
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(cardBackground)
        .accessibilityElement(children: .combine)
    }

    private var textCard: some View {
        ZStack(alignment: .topLeading) {
            if text.isEmpty {
                Text("记录此刻的想法…")
                    .foregroundStyle(Color(uiColor: .placeholderText))
                    .font(.system(size: 17))
                    .padding(.horizontal, 16)
                    .padding(.vertical, 17)
                    .allowsHitTesting(false)
            }

            TextEditor(text: $text)
                .font(.system(size: 17))
                .lineSpacing(5)
                .scrollContentBackground(.hidden)
                .padding(.horizontal, 12)
                .padding(.vertical, 9)
                .frame(minHeight: 132, maxHeight: 160)
                .background(Color.clear)
        }
        .background(cardBackground)
    }

    private var photoSection: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(images) { image in
                    ZStack(alignment: .topTrailing) {
                        Image(uiImage: image.preview)
                            .resizable()
                            .scaledToFill()
                            .frame(width: 132, height: 132)
                            .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))

                        Button {
                            images.removeAll { $0.id == image.id }
                        } label: {
                            Image(systemName: "xmark")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(.black)
                                .frame(width: 25, height: 25)
                                .background(.white.opacity(0.94), in: Circle())
                        }
                        .buttonStyle(.plain)
                        .padding(6)
                        .accessibilityLabel("移除图片")
                    }
                }

                if attachmentCount < 4 {
                    Button {
                        showingPhotoPicker = true
                    } label: {
                        Image(systemName: "plus")
                            .font(.system(size: 31, weight: .regular))
                            .foregroundStyle(FantoTheme.accent)
                            .frame(width: 132, height: 132)
                    }
                    .buttonStyle(.plain)
                    .background(
                        RoundedRectangle(cornerRadius: 13, style: .continuous)
                            .fill(Color(uiColor: .secondarySystemBackground).opacity(0.28))
                    )
                    .overlay {
                        RoundedRectangle(cornerRadius: 13, style: .continuous)
                            .strokeBorder(
                                Color(uiColor: .separator).opacity(0.42),
                                style: StrokeStyle(lineWidth: 1, dash: [5, 4])
                            )
                    }
                    .accessibilityLabel("添加图片")
                }
            }
            .padding(.vertical, 1)
        }
    }

    @ViewBuilder
    private var audioSection: some View {
        if let audio {
            HStack(spacing: 14) {
                Button {
                    play(audio)
                } label: {
                    Image(systemName: audioPlayer?.isPlaying == true ? "pause.fill" : "play.fill")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 48, height: 48)
                        .background(FantoTheme.accent, in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("播放语音")

                VStack(alignment: .leading, spacing: 7) {
                    Text("语音记录")
                        .font(.system(size: 16, weight: .medium))

                    HStack(spacing: 3) {
                        ForEach(0..<24, id: \.self) { index in
                            Capsule()
                                .fill(FantoTheme.accent)
                                .frame(width: 2, height: waveformHeight(at: index))
                        }
                    }
                    .frame(height: 19)
                }

                Spacer(minLength: 8)

                Text(durationText(audio.duration))
                    .font(.system(size: 15))
                    .foregroundStyle(.secondary)

                Button {
                    audioPlayer?.stop()
                    self.audio = nil
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.secondary)
                        .frame(width: 28, height: 28)
                        .background(Color(uiColor: .tertiarySystemFill), in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("移除语音")
            }
            .padding(.horizontal, 16)
            .frame(height: 84)
            .background(cardBackground)
        } else if audioRecorder?.isRecording == true {
            HStack(spacing: 14) {
                Image(systemName: "waveform")
                    .font(.system(size: 25, weight: .medium))
                    .foregroundStyle(FantoTheme.accent)
                    .frame(width: 36)

                VStack(alignment: .leading, spacing: 3) {
                    Text("正在录音")
                        .font(.system(size: 17, weight: .medium))
                    Text(durationText(recordingDuration))
                        .font(.system(size: 14))
                        .foregroundStyle(.secondary)
                }

                Spacer()

                Button("完成") {
                    stopRecording(discard: false)
                }
                .fontWeight(.semibold)
            }
            .padding(.horizontal, 18)
            .frame(height: 84)
            .background(cardBackground)
        } else {
            Button {
                Task { await startRecording() }
            } label: {
                HStack(spacing: 18) {
                    Image(systemName: "mic.fill")
                        .font(.system(size: 30, weight: .medium))
                        .foregroundStyle(FantoTheme.accent)
                        .frame(width: 36)

                    Text("语音输入")
                        .font(.system(size: 17, weight: .medium))
                        .foregroundStyle(FantoTheme.accent)

                    Spacer()
                }
                .padding(.horizontal, 18)
                .frame(height: 84)
            }
            .buttonStyle(.plain)
            .background(cardBackground)
            .disabled(attachmentCount >= 4)
        }
    }

    private var cardBackground: some View {
        RoundedRectangle(cornerRadius: 14, style: .continuous)
            .fill(Color(uiColor: .secondarySystemBackground).opacity(0.26))
            .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(Color(uiColor: .separator).opacity(0.22), lineWidth: 1)
            }
    }

    private var dateText: String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.dateFormat = "M月d日  EEE"
        return formatter.string(from: eventAt)
    }

    private func appendPhotos(_ items: [PhotosPickerItem]) async {
        defer { selectedPhotoItems = [] }
        let available = max(0, 4 - attachmentCount)
        guard available > 0 else { return }

        for item in items.prefix(available) {
            do {
                guard let originalData = try await item.loadTransferable(type: Data.self),
                      let preview = UIImage(data: originalData),
                      let jpeg = preview.jpegData(compressionQuality: 0.9) else {
                    continue
                }
                let width = preview.cgImage?.width ?? Int(preview.size.width * preview.scale)
                let height = preview.cgImage?.height ?? Int(preview.size.height * preview.scale)
                images.append(DraftRecordImage(data: jpeg, preview: preview, width: width, height: height))
            } catch {
                errorMessage = "图片读取失败，请重新选择。"
            }
        }
    }

    @MainActor
    private func startRecording() async {
        guard attachmentCount < 4 else { return }
        audioPlayer?.stop()

        let granted = await requestMicrophonePermission()
        guard granted else {
            errorMessage = "需要麦克风权限才能录制语音。"
            return
        }

        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .spokenAudio, options: [.defaultToSpeaker])
            try session.setActive(true)

            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent("record-\(UUID().uuidString).m4a")
            let settings: [String: Any] = [
                AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
                AVSampleRateKey: 44_100,
                AVNumberOfChannelsKey: 1,
                AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
            ]
            let recorder = try AVAudioRecorder(url: url, settings: settings)
            recorder.prepareToRecord()
            guard recorder.record() else {
                throw CocoaError(.fileWriteUnknown)
            }
            audioRecorder = recorder
            recordingStartedAt = Date.now
            recordingDuration = 0
        } catch {
            errorMessage = "无法开始录音，请稍后重试。"
        }
    }

    private func stopRecording(discard: Bool) {
        guard let recorder = audioRecorder else { return }
        recorder.stop()
        let url = recorder.url
        let duration = max(recordingDuration, recorder.currentTime)
        audioRecorder = nil
        recordingStartedAt = nil
        recordingDuration = 0

        if discard {
            try? FileManager.default.removeItem(at: url)
            return
        }

        guard duration > 0.15 else {
            try? FileManager.default.removeItem(at: url)
            return
        }
        audio = DraftRecordAudio(url: url, duration: duration)
    }

    private func play(_ audio: DraftRecordAudio) {
        do {
            if audioPlayer?.isPlaying == true {
                audioPlayer?.pause()
                return
            }
            let player = try AVAudioPlayer(contentsOf: audio.url)
            player.prepareToPlay()
            player.play()
            audioPlayer = player
        } catch {
            errorMessage = "语音暂时无法播放。"
        }
    }

    private func requestMicrophonePermission() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
    }

    @MainActor
    private func save() async {
        guard canSave, !isSaving else { return }
        isSaving = true
        defer { isSaving = false }

        do {
            var mediaIds: [String] = []

            for image in images {
                let mediaId = try await RecordWriteAPIClient.shared.upload(
                    DraftMediaUpload(
                        data: image.data,
                        mimeType: "image/jpeg",
                        capture: MediaCapturePayload(width: image.width, height: image.height)
                    )
                )
                mediaIds.append(mediaId)
            }

            if let audio {
                let data = try Data(contentsOf: audio.url)
                let mediaId = try await RecordWriteAPIClient.shared.upload(
                    DraftMediaUpload(
                        data: data,
                        mimeType: "audio/mp4",
                        capture: MediaCapturePayload(durationMs: max(1, Int(audio.duration * 1_000)))
                    )
                )
                mediaIds.append(mediaId)
            }

            try await RecordWriteAPIClient.shared.createRecord(
                text: text.trimmingCharacters(in: .whitespacesAndNewlines),
                mediaIds: mediaIds,
                location: locationEnabled ? location : nil,
                eventAt: eventAt
            )
            await store.loadRecords()
            didSave(eventAt)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func durationText(_ duration: TimeInterval) -> String {
        let seconds = max(0, Int(duration.rounded()))
        return String(format: "%02d:%02d", seconds / 60, seconds % 60)
    }

    private func waveformHeight(at index: Int) -> CGFloat {
        let pattern: [CGFloat] = [5, 11, 17, 8, 14, 19, 10, 6, 16, 12, 18, 8]
        return pattern[index % pattern.count]
    }

    private func openLocationSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
    }
}

private struct DraftRecordImage: Identifiable {
    let id = UUID()
    let data: Data
    let preview: UIImage
    let width: Int
    let height: Int
}

private struct DraftRecordAudio {
    let url: URL
    let duration: TimeInterval
}
