import AVFoundation
import SwiftUI

struct RecordMediaView: View {
    let media: RecordMedia
    @State private var selectedPhoto: RecordPhoto?
    @State private var audioPlayer: AVPlayer?
    @State private var playingAudioID: String?
    @State private var audioError: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let audio = media.audio {
                Button {
                    togglePlayback(audio)
                } label: {
                    Label(
                        Duration.seconds(audio.duration).formatted(.time(pattern: .minuteSecond)),
                        systemImage: playingAudioID == audio.id ? "stop.fill" : "play.fill"
                    )
                }
                .buttonStyle(.bordered)
                .tint(FantoTheme.accent)
                .accessibilityLabel(playingAudioID == audio.id ? "停止录音" : "播放录音")
                .accessibilityValue("时长 \(Duration.seconds(audio.duration).formatted(.time(pattern: .minuteSecond)))")
            }

            if !media.photos.isEmpty {
                HStack(spacing: 8) {
                    ForEach(media.photos.prefix(3)) { photo in
                        RecordImageThumbnail(
                            photo: photo,
                            position: (media.photos.firstIndex { $0.id == photo.id } ?? 0) + 1,
                            count: media.photos.count,
                            onSelect: { selectedPhoto = photo }
                        )
                    }
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("\(media.photos.count) 张图片")
                .fullScreenCover(item: $selectedPhoto) { photo in
                    RecordPhotoViewer(photos: media.photos, initiallySelected: photo)
                }
            }
        }
        .alert("无法播放录音", isPresented: Binding(
            get: { audioError != nil },
            set: { if !$0 { audioError = nil } }
        )) {
            Button("好", role: .cancel) { audioError = nil }
        } message: {
            Text(audioError ?? "请稍后重试。")
        }
        .onDisappear {
            stopPlayback()
        }
    }

    private func togglePlayback(_ audio: RecordAudio) {
        if playingAudioID == audio.id {
            stopPlayback()
            return
        }

        stopPlayback()
        Task {
            do {
                let url = try await FantoAPIClient.shared.fetchMediaReadURL(id: audio.id, variant: .original)
                guard !Task.isCancelled else { return }
                let player = AVPlayer(url: url)
                audioPlayer = player
                playingAudioID = audio.id
                player.play()
            } catch {
                audioError = error.localizedDescription
            }
        }
    }

    private func stopPlayback() {
        audioPlayer?.pause()
        audioPlayer?.seek(to: .zero)
        audioPlayer = nil
        playingAudioID = nil
    }

}

private struct RecordImageThumbnail: View {
    let photo: RecordPhoto
    let position: Int
    let count: Int
    let onSelect: () -> Void

    @State private var imageURL: URL?
    @State private var didRetryAfterLoadFailure = false

    var body: some View {
        Button(action: onSelect) {
            Group {
                if let imageURL {
                    AsyncImage(url: imageURL) { phase in
                        switch phase {
                        case .empty:
                            placeholder
                        case let .success(image):
                            image
                                .resizable()
                                .scaledToFill()
                        case .failure:
                            placeholder
                                .onAppear(perform: retryAfterLoadFailure)
                        @unknown default:
                            placeholder
                        }
                    }
                } else {
                    placeholder
                }
            }
        }
        .buttonStyle(.plain)
        .frame(width: 66, height: 52)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay {
            RoundedRectangle(cornerRadius: 10)
                .stroke(.background, lineWidth: 2)
        }
        .task(id: photo.id) {
            await loadReadURL()
        }
        .accessibilityLabel("查看第 \(position) 张图片，共 \(count) 张")
    }

    private var placeholder: some View {
        RoundedRectangle(cornerRadius: 10)
            .fill(FantoTheme.softAccent)
            .overlay {
                Image(systemName: "photo")
                    .foregroundStyle(FantoTheme.accent)
            }
    }

    private func retryAfterLoadFailure() {
        guard !didRetryAfterLoadFailure else { return }
        didRetryAfterLoadFailure = true
        Task {
            imageURL = nil
            await loadReadURL()
        }
    }

    private func loadReadURL() async {
        guard !Task.isCancelled else { return }
        imageURL = try? await FantoAPIClient.shared.fetchMediaReadURL(id: photo.id, variant: .thumbnail)
    }
}

private struct RecordPhotoViewer: View {
    let photos: [RecordPhoto]

    @Environment(\.dismiss) private var dismiss
    @State private var selectedPhotoID: String

    init(photos: [RecordPhoto], initiallySelected: RecordPhoto) {
        self.photos = photos
        _selectedPhotoID = State(initialValue: initiallySelected.id)
    }

    var body: some View {
        ZStack {
            Color.black
                .ignoresSafeArea()

            TabView(selection: $selectedPhotoID) {
                ForEach(photos) { photo in
                    RecordPhotoPage(photo: photo)
                        .tag(photo.id)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .accessibilityLabel("图片浏览")
        }
        .safeAreaInset(edge: .top) {
            HStack {
                Button("关闭", systemImage: "xmark", action: dismiss.callAsFunction)
                    .labelStyle(.iconOnly)
                    .buttonStyle(.bordered)
                    .tint(.white)
                    .accessibilityLabel("关闭图片浏览")

                Spacer()

                Text(pageLabel)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.white)
                    .accessibilityLabel("第 \(selectedIndex + 1) 张，共 \(photos.count) 张")
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
        }
    }

    private var selectedIndex: Int {
        photos.firstIndex { $0.id == selectedPhotoID } ?? 0
    }

    private var pageLabel: String {
        "\(selectedIndex + 1) / \(photos.count)"
    }
}

private struct RecordPhotoPage: View {
    let photo: RecordPhoto

    @State private var imageURL: URL?
    @State private var didRetryAfterLoadFailure = false

    var body: some View {
        Group {
            if let imageURL {
                AsyncImage(url: imageURL) { phase in
                    switch phase {
                    case .empty:
                        ProgressView()
                            .tint(.white)
                    case let .success(image):
                        image
                            .resizable()
                            .scaledToFit()
                            .accessibilityLabel("图片")
                    case .failure:
                        ContentUnavailableView {
                            Label("无法显示图片", systemImage: "photo")
                        } actions: {
                            Button("重新加载", action: reload)
                                .buttonStyle(.borderedProminent)
                        }
                        .foregroundStyle(.white)
                        .onAppear(perform: retryAfterLoadFailure)
                    @unknown default:
                        EmptyView()
                    }
                }
            } else {
                ProgressView()
                    .tint(.white)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task(id: photo.id) {
            await loadReadURL()
        }
    }

    private func reload() {
        imageURL = nil
        Task {
            await loadReadURL()
        }
    }

    private func retryAfterLoadFailure() {
        guard !didRetryAfterLoadFailure else { return }
        didRetryAfterLoadFailure = true
        reload()
    }

    private func loadReadURL() async {
        guard !Task.isCancelled else { return }
        imageURL = try? await FantoAPIClient.shared.fetchMediaReadURL(id: photo.id, variant: .original)
    }
}
