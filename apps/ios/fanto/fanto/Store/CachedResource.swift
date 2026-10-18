import Foundation
import Observation

nonisolated struct SettingFieldConflict: LocalizedError {
    let remoteValue: String?
    var errorDescription: String? { "这一项已在其他地方更新，请核对最新内容后再保存。" }
}

/// One refresh per app session; views only reuse the result. Explicit reloads remain possible.
@MainActor @Observable
final class CachedResource<Value: Codable & Sendable> {
    private(set) var value: Value?
    private(set) var isLoading = false
    private(set) var error: String?
    private(set) var isUpdating = false
    private var didLoad = false
    private var task: Task<Void, Never>?
    private let key: String
    private let scope: AccountCacheScope?
    private let disk: AccountCacheDisk
    private let fetch: () async throws -> Value
    private let version: (Value) -> Int
    private let isCurrent: () -> Bool
    private var revision = 0
    // Chain persistence in acceptance order so an older save cannot overwrite a newer one.
    private var persistence: Task<Void, Never>?

    init(key: String, scope: AccountCacheScope?, disk: AccountCacheDisk = .shared,
         version: @escaping (Value) -> Int, isCurrent: @escaping () -> Bool,
         fetch: @escaping () async throws -> Value) {
        self.key = key; self.scope = scope; self.disk = disk
        self.version = version; self.isCurrent = isCurrent; self.fetch = fetch
    }

    func accept(_ next: Value) {
        guard isCurrent(), value.map({ version(next) >= version($0) }) ?? true else { return }
        value = next; error = nil; didLoad = true; revision += 1
        guard let scope, let data = try? JSONEncoder().encode(next) else { return }
        let previous = persistence
        let disk = disk, key = key
        persistence = Task {
            await previous?.value
            await disk.write(data, key: key, scope: scope)
        }
    }

    func load(force: Bool = false) async {
        if let task { await task.value; return }
        guard !didLoad || force, isCurrent() else { return }
        isLoading = true
        let work = Task { await self.readAndRefresh() }
        task = work
        await work.value
        task = nil; isLoading = false
    }

    func restore() async {
        guard value == nil, let scope, isCurrent(),
              let data = await disk.read(key, scope: scope),
              let snapshot = try? JSONDecoder().decode(Value.self, from: data),
              value == nil, isCurrent() else { return }
        value = snapshot
    }

    /// A field mutation never resubmits unrelated fields from an old editor snapshot.
    func update(original: String?, desired: String?, field: (Value) -> String?,
                save: (Value) async throws -> Value) async throws {
        guard isCurrent() else { throw CancellationError() }
        guard !isUpdating, let base = value else {
            throw NSError(domain: "FantoSettings", code: 1, userInfo: [NSLocalizedDescriptionKey: "请等待当前资料读取或保存完成。"])
        }
        if field(base) == desired { return }
        guard field(base) == original else { throw SettingFieldConflict(remoteValue: field(base)) }
        isUpdating = true
        defer { isUpdating = false }
        do {
            let next = try await save(base)
            guard isCurrent() else { throw CancellationError() }
            accept(next)
        } catch {
            guard isCurrent(), !(error is CancellationError) else { throw CancellationError() }
            // Recover an uncertain response without treating an upload as a confirmed binding.
            if let remote = try? await fetch() {
                guard isCurrent() else { throw CancellationError() }
                accept(remote)
                if field(remote) == desired { return }
                if field(remote) != original { throw SettingFieldConflict(remoteValue: field(remote)) }
            }
            throw error
        }
    }

    private func readAndRefresh() async {
        let initialRevision = revision
        await restore()
        guard isCurrent() else { return }
        do {
            let next = try await fetch()
            guard isCurrent() else { return }
            // A successful mutation while this GET was in flight wins, including equal versions.
            if revision == initialRevision || value.map({ version(next) > version($0) }) == true { accept(next) }
        } catch {
            guard isCurrent(), revision == initialRevision, !(error is CancellationError) else { return }
            self.error = error.localizedDescription
        }
        // Failure is retried explicitly, not on every subsequent page appearance.
        didLoad = true
    }
}
