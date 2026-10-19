import SwiftUI

enum AppTab: Hashable {
    case records
    case fanto
    case userCenter
}

struct AppRootView: View {
    @Environment(FantoStore.self) private var fantoStore
    @State private var userProfile: UserProfileStore
    @State private var fantoProfile: FantoSettingsStore
    @State private var selection: AppTab = .records
    @State private var conversationStore: ConversationStore
    @State private var tabAvatar: UIImage?

    private var avatarID: String? { fantoProfile.settings?.avatarMediaId }
    private var tabTitle: String {
        let nickname = fantoProfile.settings?.nickname ?? "Fanto"
        return nickname.count > 6 ? String(nickname.prefix(6)) + "…" : nickname
    }

    init(conversationStore: ConversationStore, userProfile: UserProfileStore? = nil, fantoProfile: FantoSettingsStore? = nil) {
        let fantoProfile = fantoProfile ?? FantoSettingsStore()
        _conversationStore = State(initialValue: conversationStore)
        _userProfile = State(initialValue: userProfile ?? UserProfileStore())
        _fantoProfile = State(initialValue: fantoProfile)
        let image = if let id = fantoProfile.settings?.avatarMediaId {
            MediaImageCache.shared.cached(id: id, variant: .thumbnail)
        } else {
            UIImage(named: "FantoAvatar")
        }
        _tabAvatar = State(initialValue: image.map(Self.makeTabAvatar))
    }

    var body: some View {
        TabView(selection: $selection) {
            Tab("记录", systemImage: "rectangle.stack", value: .records) {
                RecordsView()
            }
            Tab(value: .fanto) {
                FantoConversationView(store: conversationStore)
            } label: {
                Label {
                    Text(tabTitle)
                } icon: {
                    if let tabAvatar {
                        Image(uiImage: tabAvatar).renderingMode(.original)
                    } else {
                        Image(systemName: "person.crop.circle")
                    }
                }
            }
            Tab("我的", systemImage: "person.crop.circle", value: .userCenter) {
                UserCenterView(profile: userProfile)
            }
        }
        .environment(\.userProfile, userProfile)
        .environment(\.fantoProfile, fantoProfile)
        .environment(\.defaultMinListRowHeight, 44)
        .task { await fantoStore.loadRecords() }
        .task { await fantoProfile.load() }
        .task(id: avatarID) {
            let requestedID = avatarID
            let image: UIImage?
            if let requestedID {
                image = try? await MediaImageCache.shared.image(id: requestedID, variant: .thumbnail)
            } else {
                image = UIImage(named: "FantoAvatar")
            }
            guard !Task.isCancelled, requestedID == avatarID else { return }
            if let image { tabAvatar = Self.makeTabAvatar(image) }
        }
        .task { await userProfile.load() }
        .task { await userProfile.loadAccount() }
        .task { await userProfile.loadStatistics() }
        .onChange(of: fantoStore.recordStatisticsRevision) { _, _ in
            Task { await userProfile.loadStatistics(force: true) }
        }
        .tint(FantoTheme.accent)
        .task {
            await conversationStore.load(profile: fantoProfile)
        }
    }

    /// Native tab items need a raster icon: frame/clip modifiers in a label are not preserved by UITabBar.
    private static func makeTabAvatar(_ image: UIImage) -> UIImage {
        let side: CGFloat = 25
        return UIGraphicsImageRenderer(size: CGSize(width: side, height: side)).image { _ in
            let bounds = CGRect(x: 0, y: 0, width: side, height: side)
            UIBezierPath(ovalIn: bounds).addClip()
            let scale = max(side / image.size.width, side / image.size.height)
            let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
            image.draw(in: CGRect(x: (side - size.width) / 2, y: (side - size.height) / 2,
                                  width: size.width, height: size.height))
        }.withRenderingMode(.alwaysOriginal)
    }
}

#Preview {
    AppRootView(conversationStore: ConversationStore())
        .environment(FantoStore.preview)
}
