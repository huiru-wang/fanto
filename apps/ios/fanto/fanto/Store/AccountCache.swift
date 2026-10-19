import Foundation

@MainActor
final class AccountCache {
    static let shared = AccountCache()
    private(set) var scope: AccountCacheScope?

    func activate(for userID: String) async {
        let next = AccountCacheScope(userID: userID)
        scope = next
        MediaImageCache.shared.reset()
        await AccountCacheDisk.shared.activate(next)
        await RecordDraftStore.shared.activate(next)
    }

    func clear() async {
        let previous = scope
        scope = nil
        MediaImageCache.shared.reset()
        if let previous { await AccountCacheDisk.shared.clear(previous) }
    }

    func invalidate() {
        let previous = scope
        scope = nil
        MediaImageCache.shared.reset()
        if let previous { Task { await AccountCacheDisk.shared.clear(previous) } }
    }
}
