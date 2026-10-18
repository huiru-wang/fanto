import Foundation
import Observation

@MainActor @Observable
final class FantoSettingsEditor {
    var draft = FantoSettings()
    private(set) var saved: FantoSettings?
    private(set) var isSaving = false
    private(set) var isLoading = false
    var errorMessage: String?
    private(set) var conflicts: Set<String> = []
    private let profile: FantoSettingsStore
    init(profile: FantoSettingsStore) { self.profile = profile }
    var hasChanges: Bool { saved.map { !draft.textChanges(from: $0).isEmpty } ?? false }
    var invalidText: Bool { draft.nickname.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || draft.nickname.count > 30 || draft.description.count > 300 || draft.roleConfig.exceedsLimit }
    func load() async {
        guard saved == nil, !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        do { let value = try await FantoAPIClient.shared.fetchFantoSettings(); try Task.checkCancellation(); apply(value, keepingDraft: false) }
        catch { if !Task.isCancelled { errorMessage = error.localizedDescription } }
    }
    private func apply(_ remote: FantoSettings, keepingDraft: Bool) {
        if keepingDraft, let base = saved {
            let changes = draft.textChanges(from: base)
            var next = remote
            if let nickname = changes.nickname {
                if remote.nickname != base.nickname && remote.nickname != nickname { conflicts.insert("nickname") }
                next.nickname = nickname
            }
            if let description = changes.description {
                if remote.description != base.description && remote.description != description { conflicts.insert("description") }
                next.description = description
            }
            for (key, value) in changes.roleConfig ?? [:] {
                if remote.roleConfig[key] != base.roleConfig[key] && remote.roleConfig[key] != value { conflicts.insert(key) }
                next.roleConfig[key] = value
            }
            draft = next
        } else { draft = remote; conflicts = [] }
        saved = remote
        profile.accept(remote)
    }
    func resolveConflicts(useLocal: Bool) { if !useLocal, let saved { draft = saved }; conflicts = [] }
    func saveText() async -> Bool {
        guard let saved, !isSaving, !invalidText, conflicts.isEmpty else { return false }
        isSaving = true; errorMessage = nil
        defer { isSaving = false }
        let changes = draft.textChanges(from: saved)
        do { apply(try await FantoAPIClient.shared.updateFantoSettings(version: saved.version, changes: changes), keepingDraft: false); return true }
        catch {
            if let remote = try? await FantoAPIClient.shared.fetchFantoSettings() {
                if draft.textChanges(from: remote).isEmpty { apply(remote, keepingDraft: false); return true }
                apply(remote, keepingDraft: true)
            }
            errorMessage = "保存失败或远端已更新，草稿仍保留，请核对后重试。"
            return false
        }
    }
    func saveAvatar(_ mediaID: String?) async throws {
        guard let saved, !isSaving else { throw FantoAPIError.server("请等待设置读取或保存完成。", code: nil) }
        isSaving = true; errorMessage = nil
        defer { isSaving = false }
        var changes = FantoSettingsChanges()
        changes.updatesAvatar = true; changes.avatarMediaId = mediaID
        do { apply(try await FantoAPIClient.shared.updateFantoSettings(version: saved.version, changes: changes), keepingDraft: true) }
        catch {
            if let remote = try? await FantoAPIClient.shared.fetchFantoSettings() {
                apply(remote, keepingDraft: true)
                if remote.avatarMediaId == mediaID { return }
            }
            throw FantoAPIError.server("头像保存未确认或远端已更新。构图和上传结果已保留，再次保存将更新当前头像。", code: nil)
        }
    }
}
