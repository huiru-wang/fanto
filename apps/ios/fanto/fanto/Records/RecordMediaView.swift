import SwiftUI

struct RecordMediaView: View {
    let media: RecordMedia
    @State private var selectedPhoto: RecordPhoto?

    var body: some View {
        switch media {
        case let .photos(photos):
            HStack(spacing: 8) {
                ForEach(photos.prefix(3)) { photo in
                    RecordImageThumbnail(
                        photo: photo,
                        position: (photos.firstIndex { $0.id == photo.id } ?? 0) + 1,
                        count: photos.count,
                        onSelect: { selectedPhoto = photo }
                    )
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(photos.count) 张图片")
            .fullScreenCover(item: $selectedPhoto) { photo in
                RecordPhotoViewer(photos: photos, initiallySelected: photo)
            }

        case let .audio(duration):
            Button {
                // Playback will be connected to the persisted audio asset in the media integration.
            } label: {
                Label(Duration.seconds(duration).formatted(.time(pattern: .minuteSecond)), systemImage: "play.fill")
            }
                .buttonStyle(.bordered)
                .tint(FantoTheme.accent)
                .accessibilityLabel("播放录音")
                .accessibilityValue("时长 \(Duration.seconds(duration).formatted(.time(pattern: .minuteSecond)))")
        }
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
        imageURL = try? await CreationAPIClient.shared.fetchMediaReadURL(id: photo.id)
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
        imageURL = try? await CreationAPIClient.shared.fetchMediaReadURL(id: photo.id)
    }
}
