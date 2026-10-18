import Foundation

nonisolated private struct Sample: Codable, Sendable, Equatable {
    let version: Int
    let name: String
}

@MainActor private final class FetchProbe {
    var calls = 0
    var pending: CheckedContinuation<Sample, Error>?
    func fetch() async throws -> Sample {
        calls += 1
        return try await withCheckedThrowingContinuation { pending = $0 }
    }
    func waitUntilRequested() async throws {
        for _ in 0..<10_000 {
            if pending != nil { return }
            await Task.yield()
        }
        throw TestFailure.failed("fetch did not start")
    }
    func succeed(_ sample: Sample) { pending?.resume(returning: sample); pending = nil }
    func fail() { pending?.resume(throwing: URLError(.notConnectedToInternet)); pending = nil }
}

private enum TestFailure: Error { case failed(String) }

@main struct CacheTests {
    @MainActor static func check(_ condition: Bool, _ message: String) throws {
        if !condition { throw TestFailure.failed(message) }
    }

    @MainActor static func main() async throws {
        let root = URL.temporaryDirectory.appending(path: "fanto-cache-tests-\(UUID())")
        defer { try? FileManager.default.removeItem(at: root) }
        let disk = AccountCacheDisk(root: root, imageBudget: 10)
        let a = AccountCacheScope(userID: "account-a")
        let b = AccountCacheScope(userID: "account-b")
        await disk.activate(a)
        var active = a
        let probe = FetchProbe()
        let resource = CachedResource(key: "profile", scope: a, disk: disk, version: { $0.version },
            isCurrent: { active == a }, fetch: { try await probe.fetch() })

        // Multiple screens await one request; entering again doesn't start another GET.
        let first = Task { await resource.load() }
        let second = Task { await resource.load() }
        try await probe.waitUntilRequested()
        probe.succeed(Sample(version: 1, name: "server"))
        await first.value; await second.value
        await resource.load()
        try check(probe.calls == 1 && resource.value?.name == "server", "loads must coalesce and be reused")

        // A mutation wins over an older GET that finishes later.
        let refresh = Task { await resource.load(force: true) }
        try await probe.waitUntilRequested()
        resource.accept(Sample(version: 3, name: "saved"))
        resource.accept(Sample(version: 2, name: "obsolete save"))
        probe.succeed(Sample(version: 1, name: "stale GET"))
        await refresh.value
        try check(resource.value?.name == "saved", "a late response must not overwrite a successful save")

        // Explicit refresh failure preserves visible data, and does not trigger page-entry retry loops.
        let offline = Task { await resource.load(force: true) }
        try await probe.waitUntilRequested(); probe.fail(); await offline.value
        await resource.load()
        try check(resource.value?.name == "saved" && resource.error != nil && probe.calls == 3, "offline refresh must retain content")

        // A new store restores disk data before its startup request completes.
        let snapshot = try JSONEncoder().encode(Sample(version: 4, name: "disk"))
        // Drain acceptance writes before installing this fixture.
        for _ in 0..<10_000 {
            if let data = await disk.read("profile", scope: a),
               (try? JSONDecoder().decode(Sample.self, from: data).version) == 3 { break }
            await Task.yield()
        }
        await disk.write(snapshot, key: "profile", scope: a)
        let coldProbe = FetchProbe()
        let restored = CachedResource(key: "profile", scope: a, disk: disk, version: { $0.version },
            isCurrent: { active == a }, fetch: { try await coldProbe.fetch() })
        let cold = Task { await restored.load() }
        try await coldProbe.waitUntilRequested()
        try check(restored.value?.name == "disk", "snapshot must render before network finishes")
        coldProbe.succeed(Sample(version: 5, name: "latest")); await cold.value
        try check(restored.value?.name == "latest", "cold launch must synchronize server state")

        // Independent edits bind against the current resource version and write through immediately.
        let mutationProbe = FetchProbe()
        let mutations = CachedResource(key: "writes", scope: a, disk: disk, version: { $0.version },
            isCurrent: { active == a }, fetch: { try await mutationProbe.fetch() })
        mutations.accept(Sample(version: 1, name: "before"))
        try await mutations.update(original: "before", desired: "after", field: { $0.name }) { base in
            try check(base.version == 1, "field save must use the current version")
            return Sample(version: 2, name: "after")
        }
        try check(mutations.value?.name == "after", "a field save must update the shared cache")
        var overwrote = false
        do {
            try await mutations.update(original: "before", desired: "other", field: { $0.name }) { _ in
                overwrote = true
                return Sample(version: 3, name: "other")
            }
            throw TestFailure.failed("concurrent field edit must require confirmation")
        } catch let conflict as SettingFieldConflict {
            try check(conflict.remoteValue == "after" && !overwrote, "same-field changes must not be silently overwritten")
        }
        let uncertain = Task {
            try await mutations.update(original: "after", desired: "confirmed", field: { $0.name }) { _ in
                throw URLError(.networkConnectionLost)
            }
        }
        try await mutationProbe.waitUntilRequested()
        mutationProbe.succeed(Sample(version: 3, name: "confirmed"))
        try await uncertain.value
        try check(mutations.value?.name == "confirmed", "a lost save response must be confirmed by reading the saved field")

        // Omitted and explicit null are distinct: a nickname edit must never send coverMediaId.
        for (field, value) in [(UserProfileField.nickname, "名字" as String?), (.signature, ""), (.avatarMediaId, nil), (.coverMediaId, nil)] {
            let data = try JSONEncoder().encode(UserProfileChanges(field: field, value: value))
            let object = try JSONSerialization.jsonObject(with: data) as! [String: Any]
            try check(Set(object.keys) == [field.rawValue], "PATCH must contain only the edited field")
            if let value { try check(object[field.rawValue] as? String == value, "field value must survive serialization") }
            else { try check(object[field.rawValue] is NSNull, "clearing a media binding must encode explicit null") }
        }

        // Account switch blocks pending responses and old-session disk writes.
        let old = Task { await resource.load(force: true) }
        try await probe.waitUntilRequested()
        active = b; await disk.activate(b)
        probe.succeed(Sample(version: 99, name: "late account-a")); await old.value
        try check(resource.value?.name == "saved", "old account request must be ignored")
        await disk.write(Data("secret".utf8), key: "private", scope: a)
        let rejected = await disk.read("private", scope: b)
        try check(rejected == nil, "old session must not write another account's cache")

        // Both namespace isolation and removal survive changing session IDs.
        await disk.write(Data("b".utf8), key: "profile", scope: b)
        await disk.clear(a)
        let intact = await disk.read("profile", scope: b)
        try check(intact == Data("b".utf8), "late cleanup must not clear current account")
        await disk.clear(b)
        await disk.activate(AccountCacheScope(userID: "account-a"))
        await disk.activate(b)
        let cleared = await disk.read("profile", scope: b)
        try check(cleared == nil, "logout must remove persistent account data")

        // Image disk budget is bounded and the most recent access survives eviction.
        await disk.write(Data(repeating: 1, count: 6), key: "old", scope: b, image: true)
        await disk.write(Data(repeating: 2, count: 6), key: "new", scope: b, image: true)
        let oldImage = await disk.read("old", scope: b, image: true)
        let newImage = await disk.read("new", scope: b, image: true)
        try check(oldImage == nil && newImage?.count == 6, "image budget must evict the oldest file")
        print("PASS: cache reuse, coalescing, mutation races, offline, cold restore, individual saves, conflict protection, uncertain response recovery, partial PATCH encoding, account isolation, logout, image budget")
    }
}
