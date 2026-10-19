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

        // Rebinding the Fanto session writes through without changing the role or losing to an old GET.
        var fanto = FantoSettings()
        fanto.fantoId = UUID().uuidString; fanto.sessionId = UUID().uuidString
        fanto.nickname = "角色昵称"; fanto.roleConfig.character = "保留角色"; fanto.version = 1
        let oldFanto = fanto
        let newSessionID = UUID().uuidString
        var pendingFanto: CheckedContinuation<FantoSettings, Error>?
        let fantoResource = CachedResource(key: "fanto", scope: a, disk: disk, version: { $0.version },
            isCurrent: { active == a }, fetch: { try await withCheckedThrowingContinuation { pendingFanto = $0 } })
        fantoResource.accept(oldFanto)
        let staleFanto = Task { await fantoResource.load(force: true) }
        for _ in 0..<10_000 { if pendingFanto != nil { break }; await Task.yield() }
        try check(pendingFanto != nil, "Fanto refresh must start")
        try await fantoResource.update(original: oldFanto.sessionId, desired: newSessionID, field: { $0.sessionId }) { current in
            var updated = current
            updated.sessionId = newSessionID; updated.version += 1
            return updated
        }
        pendingFanto?.resume(returning: oldFanto)
        await staleFanto.value
        try check(fantoResource.value?.sessionId == newSessionID, "old GET must not resurrect cleared conversation")
        try check(fantoResource.value?.fantoId == oldFanto.fantoId && fantoResource.value?.roleConfig == oldFanto.roleConfig,
                  "new session must keep the Fanto identity and role")
        var sessionChanges = FantoSettingsChanges()
        sessionChanges.sessionId = newSessionID
        let sessionObject = try JSONSerialization.jsonObject(with: JSONEncoder().encode(sessionChanges)) as! [String: Any]
        try check(Set(sessionObject.keys) == ["sessionId"], "session PATCH must not include any role or legacy session fields")
        for _ in 0..<10_000 {
            if let data = await disk.read("fanto", scope: a),
               (try? JSONDecoder().decode(FantoSettings.self, from: data).sessionId) == newSessionID { break }
            await Task.yield()
        }
        let reopened = CachedResource(key: "fanto", scope: a, disk: disk, version: { $0.version },
            isCurrent: { active == a }, fetch: { oldFanto })
        await reopened.restore()
        try check(reopened.value?.sessionId == newSessionID, "reopening must restore the newly selected session")

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

        // Unsaved composer work survives closing/relaunch, stays account-scoped, and clears after queued writes.
        let drafts = RecordDraftStore(root: root.appending(path: "drafts"))
        let persistence = RecordDraftPersistence(disk: drafts)
        await drafts.activate(a)
        let photoID = UUID()
        let photo = RecordDraftPhoto(id: photoID, data: Data("original-jpeg-bytes".utf8), width: 1024, height: 768, mediaID: "ready-media")
        let place = RecordLocation(name: "手动地点", country: "中国", city: "北京市", district: "西城区", latitude: 39.9, longitude: 116.3)
        let draft = RecordComposerDraft(text: "未提交的文字\n保持换行", eventAt: Date(timeIntervalSince1970: 1000),
            location: place, acceptsLocationSuggestion: false, photos: [photo])
        persistence.save(draft, scope: a)
        let resumed = try await persistence.load(scope: a)
        try check(resumed?.text == draft.text && resumed?.eventAt == draft.eventAt && resumed?.location == place,
                  "closing/reopening must restore composer text, date and manually chosen location")
        try check(resumed?.photos.first?.data == photo.data && resumed?.photos.first?.mediaID == "ready-media",
                  "draft photos must restore exact JPEG bytes and completed upload IDs")
        let newSession = AccountCacheScope(userID: a.userID)
        await drafts.activate(newSession)
        let coldDraft = try await drafts.load(scope: newSession)
        try check(coldDraft?.photos.first?.id == photoID,
                  "a new authenticated session must restore the same account's draft")
        await drafts.activate(b)
        let otherDraft = try await drafts.load(scope: b)
        try check(otherDraft == nil, "another account must not see the draft")
        do {
            try await drafts.save(draft, scope: a)
            throw TestFailure.failed("stale account must not write draft")
        } catch is CancellationError { }
        await drafts.activate(a)
        persistence.save(draft, scope: a)
        try await persistence.clear(scope: a)
        let submittedDraft = try await persistence.load(scope: a)
        try check(submittedDraft == nil, "pending autosaves must not resurrect a submitted draft")
        let remaining = try FileManager.default.subpathsOfDirectory(atPath: root.appending(path: "drafts").path)
        try check(!remaining.contains(where: { $0.hasSuffix(".jpg") }), "submit must also remove draft photo files")

        // Image disk budget is bounded and the most recent access survives eviction.
        await disk.write(Data(repeating: 1, count: 6), key: "old", scope: b, image: true)
        await disk.write(Data(repeating: 2, count: 6), key: "new", scope: b, image: true)
        let oldImage = await disk.read("old", scope: b, image: true)
        let newImage = await disk.read("new", scope: b, image: true)
        try check(oldImage == nil && newImage?.count == 6, "image budget must evict the oldest file")
        print("PASS: cache reuse, coalescing, mutation races, offline, cold restore, individual saves, conflict protection, uncertain response recovery, partial PATCH encoding, account isolation, logout, image budget, composer draft restoration/isolation/submit cleanup")
    }
}
