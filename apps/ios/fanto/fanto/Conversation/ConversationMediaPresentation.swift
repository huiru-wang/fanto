import AVFoundation
import Observation
import SwiftUI

struct ConversationMediaPresentation: View {
    let items: [PresentedMedia]

    private var images: [PresentedMedia] { items.filter { $0.mediaType == .image } }
    private var audio: [PresentedMedia] { items.filter { $0.mediaType == .audio } }

    var body: some View {
        if !images.isEmpty || !audio.isEmpty {
            VStack(alignment: .leading, spacing: 14) {
                if !images.isEmpty {
                    ConversationImageRail(items: images)
                }
                if !audio.isEmpty {
                    ConversationAudioRail(items: audio)
                }
            }
            .padding(.top, 2)
        }
    }
}

private struct ConversationImageRail: View {
    let items: [PresentedMedia]
    @State private var selectedImage: PresentedMedia?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("图片")
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)

            ScrollView(.horizontal) {
                HStack(spacing: 8) {
                    ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                        ConversationImageThumbnail(item: item, position: index + 1, count: items.count) {
                            selectedImage = item
                        }
                    }
                }
            }
            .scrollIndicators(.hidden)
        }
        .fullScreenCover(item: $selectedImage) { image in
            ConversationImageViewer(items: items, initiallySelected: image)
        }
    }
}

private struct ConversationImageThumbnail: View {
    let item: PresentedMedia
    let position: Int
    let count: Int
    let select: () -> Void

    @State private var imageURL: URL?
    @State private var failed = false
    @State private var didRetryAfterLoadFailure = false

    var body: some View {
        Button(action: select) {
            Group {
                if let imageURL {
                    AsyncImage(url: imageURL) { phase in
                        switch phase {
                        case .empty:
                            loading
                        case let .success(image):
                            image
                                .resizable()
                                .scaledToFill()
                        case .failure:
                            unavailable
                                .onAppear(perform: retryAfterLoadFailure)
                        @unknown default:
                            loading
                        }
                    }
                } else if failed {
                    unavailable
                } else {
                    loading
                }
            }
        }
        .buttonStyle(.plain)
        .frame(width: 104, height: 104)
        .background(Color.secondary.opacity(0.12), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .task(id: item.id) {
            await loadReadURL()
        }
        .accessibilityLabel("查看第 \(position) 张图片，共 \(count) 张")
    }

    private var loading: some View {
        ProgressView()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var unavailable: some View {
        Image(systemName: "photo")
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func retryAfterLoadFailure() {
        guard !didRetryAfterLoadFailure else { return }
        didRetryAfterLoadFailure = true
        reload()
    }

    private func reload() {
        imageURL = nil
        failed = false
        Task { await loadReadURL() }
    }

    private func loadReadURL() async {
        guard !Task.isCancelled else { return }
        do {
            imageURL = try await CreationAPIClient.shared.fetchMediaReadURL(id: item.mediaID)
        } catch {
            failed = true
        }
    }
}

private struct ConversationImageViewer: View {
    let items: [PresentedMedia]

    @Environment(\.dismiss) private var dismiss
    @State private var selectedID: String

    init(items: [PresentedMedia], initiallySelected: PresentedMedia) {
        self.items = items
        _selectedID = State(initialValue: initiallySelected.id)
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            TabView(selection: $selectedID) {
                ForEach(items) { item in
                    ConversationImagePage(item: item)
                        .tag(item.id)
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

                if items.count > 1 {
                    Text("\(selectedIndex + 1) / \(items.count)")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.white)
                        .accessibilityLabel("第 \(selectedIndex + 1) 张，共 \(items.count) 张")
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
        }
    }

    private var selectedIndex: Int {
        items.firstIndex { $0.id == selectedID } ?? 0
    }
}

private struct ConversationImagePage: View {
    let item: PresentedMedia

    @State private var imageURL: URL?
    @State private var failed = false
    @State private var didRetryAfterLoadFailure = false

    var body: some View {
        Group {
            if let imageURL {
                AsyncImage(url: imageURL) { phase in
                    switch phase {
                    case .empty:
                        ProgressView().tint(.white)
                    case let .success(image):
                        image
                            .resizable()
                            .scaledToFit()
                            .accessibilityLabel("图片")
                    case .failure:
                        unavailable
                            .onAppear(perform: retryAfterLoadFailure)
                    @unknown default:
                        ProgressView().tint(.white)
                    }
                }
            } else if failed {
                unavailable
            } else {
                ProgressView().tint(.white)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task(id: item.id) {
            await loadReadURL()
        }
    }

    private var unavailable: some View {
        ContentUnavailableView {
            Label("无法显示图片", systemImage: "photo")
        } actions: {
            Button("重新加载", action: reload)
                .buttonStyle(.borderedProminent)
        }
        .foregroundStyle(.white)
    }

    private func retryAfterLoadFailure() {
        guard !didRetryAfterLoadFailure else { return }
        didRetryAfterLoadFailure = true
        reload()
    }

    private func reload() {
        imageURL = nil
        failed = false
        Task { await loadReadURL() }
    }

    private func loadReadURL() async {
        guard !Task.isCancelled else { return }
        do {
            imageURL = try await CreationAPIClient.shared.fetchMediaReadURL(id: item.mediaID)
        } catch {
            failed = true
        }
    }
}

private struct ConversationAudioRail: View {
    let items: [PresentedMedia]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("语音")
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)
            ForEach(items) { item in
                ConversationAudioTile(item: item)
            }
        }
    }
}

private struct ConversationAudioTile: View {
    let item: PresentedMedia

    @State private var readURL: URL?
    @State private var failed = false
    @State private var didRetryAfterPlaybackFailure = false
    @State private var playback = ConversationAudioPlayback()

    var body: some View {
        HStack(spacing: 10) {
            if readURL != nil, !playback.failed {
                Button(action: playback.toggle) {
                    Image(systemName: playback.isPlaying ? "pause.fill" : "play.fill")
                        .font(.body.weight(.semibold))
                        .frame(width: 34, height: 34)
                }
                .buttonStyle(.borderedProminent)
                .clipShape(Circle())
                .accessibilityLabel(playback.isPlaying ? "暂停语音" : "播放语音")

                VStack(alignment: .leading, spacing: 2) {
                    Text("语音")
                        .font(.subheadline.weight(.medium))
                    Text("\(timeText(playback.position)) / \(timeText(duration))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } else if failed || playback.failed {
                Button("重新加载", action: reload)
                    .buttonStyle(.bordered)
            } else {
                ProgressView()
                Text("加载语音…")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 0)
        }
        .padding(10)
        .background(Color.secondary.opacity(0.10), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .task(id: item.id) {
            await loadReadURL()
        }
        .onChange(of: playback.failed) { _, playbackFailed in
            guard playbackFailed, !didRetryAfterPlaybackFailure else { return }
            didRetryAfterPlaybackFailure = true
            reload()
        }
        .onDisappear {
            playback.tearDown()
        }
        .accessibilityElement(children: .contain)
    }

    private var duration: TimeInterval {
        TimeInterval(item.durationMS ?? 0) / 1_000
    }

    private func timeText(_ value: TimeInterval) -> String {
        let seconds = max(0, Int(value.rounded()))
        return "\(seconds / 60):\(String(format: "%02d", seconds % 60))"
    }

    private func reload() {
        readURL = nil
        failed = false
        playback.tearDown()
        Task { await loadReadURL() }
    }

    private func loadReadURL() async {
        guard !Task.isCancelled else { return }
        do {
            let url = try await CreationAPIClient.shared.fetchMediaReadURL(id: item.mediaID)
            readURL = url
            playback.load(url: url)
        } catch {
            failed = true
        }
    }
}

@Observable
@MainActor
private final class ConversationAudioPlayback {
    private(set) var isPlaying = false
    private(set) var position: TimeInterval = 0
    private(set) var failed = false

    private var player: AVPlayer?
    private var timeObserver: Any?
    private var finishObserver: NSObjectProtocol?
    private var statusObservation: NSKeyValueObservation?

    func load(url: URL) {
        tearDown()
        failed = false
        position = 0

        let item = AVPlayerItem(url: url)
        statusObservation = item.observe(\.status, options: [.new]) { [weak self] item, _ in
            guard item.status == .failed else { return }
            Task { @MainActor [weak self] in self?.markFailed() }
        }

        let player = AVPlayer(playerItem: item)
        self.player = player
        timeObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.25, preferredTimescale: 600),
            queue: .main
        ) { [weak self] time in
            let seconds = time.seconds.isFinite ? max(0, time.seconds) : 0
            Task { @MainActor [weak self] in self?.position = seconds }
        }
        finishObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: item,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor [weak self] in self?.didFinish() }
        }
    }

    func toggle() {
        guard let player else { return }
        if isPlaying {
            player.pause()
            isPlaying = false
        } else {
            player.play()
            isPlaying = true
        }
    }

    func tearDown() {
        player?.pause()
        if let timeObserver, let player {
            player.removeTimeObserver(timeObserver)
        }
        if let finishObserver {
            NotificationCenter.default.removeObserver(finishObserver)
        }
        timeObserver = nil
        finishObserver = nil
        statusObservation = nil
        player = nil
        isPlaying = false
        position = 0
    }

    private func markFailed() {
        player?.pause()
        isPlaying = false
        failed = true
    }

    private func didFinish() {
        player?.seek(to: .zero)
        position = 0
        isPlaying = false
    }
}
