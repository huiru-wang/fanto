import Foundation
import CryptoKit

nonisolated struct AccountCacheScope: Equatable, Sendable {
    let userID: String
    let sessionID = UUID()
}

/// Serializes file access and rejects writes from a previous authenticated session.
actor AccountCacheDisk {
    static let shared = AccountCacheDisk()
    private var scope: AccountCacheScope?
    private let root: URL
    private let imageBudget: Int

    init(root: URL = URL.cachesDirectory.appending(path: "FantoAccountCache/v1"), imageBudget: Int = 150 * 1024 * 1024) {
        self.root = root
        self.imageBudget = imageBudget
    }

    func activate(_ scope: AccountCacheScope) { self.scope = scope }

    func read(_ key: String, scope: AccountCacheScope, image: Bool = false) -> Data? {
        guard self.scope == scope else { return nil }
        let url = file(key, scope: scope, image: image)
        guard let data = try? Data(contentsOf: url) else { return nil }
        if image { try? FileManager.default.setAttributes([.modificationDate: Date.now], ofItemAtPath: url.path) }
        return data
    }

    func write(_ data: Data, key: String, scope: AccountCacheScope, image: Bool = false) {
        guard self.scope == scope else { return }
        let url = file(key, scope: scope, image: image)
        do {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true,
                attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
            try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            if image { trimImages(in: url.deletingLastPathComponent()) }
        } catch { /* Cache failures must not fail a successful server operation. */ }
    }

    func remove(_ key: String, scope: AccountCacheScope, image: Bool = false) {
        guard self.scope == scope else { return }
        try? FileManager.default.removeItem(at: file(key, scope: scope, image: image))
    }

    func clear(_ scope: AccountCacheScope) {
        // A late logout cleanup must not remove a newly authenticated session's files.
        guard self.scope == scope else { return }
        self.scope = nil
        try? FileManager.default.removeItem(at: root.appending(path: digest(scope.userID)))
    }

    private func file(_ key: String, scope: AccountCacheScope, image: Bool) -> URL {
        root.appending(path: digest(scope.userID)).appending(path: image ? "images" : "metadata")
            .appending(path: digest(key))
    }

    private func digest(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    private func trimImages(in directory: URL) {
        let keys: Set<URLResourceKey> = [.fileSizeKey, .contentModificationDateKey]
        guard let files = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: Array(keys)) else { return }
        let entries = files.compactMap { url -> (URL, Int, Date)? in
            guard let info = try? url.resourceValues(forKeys: keys) else { return nil }
            return (url, info.fileSize ?? 0, info.contentModificationDate ?? .distantPast)
        }.sorted { $0.2 < $1.2 }
        var size = entries.reduce(0) { $0 + $1.1 }
        for (url, bytes, _) in entries where size > imageBudget {
            if (try? FileManager.default.removeItem(at: url)) != nil { size -= bytes }
        }
    }
}
