import SwiftUI
import PhotosUI

struct UserProfileEditView: View {
    let profile: UserProfileStore
    @Environment(\.dismiss) private var dismiss
    @State private var base: UserProfile
    @State private var draft: UserProfile
    @State private var photo: PhotosPickerItem?
    @State private var cropSource: AvatarSource?
    @State private var isImporting = false
    @State private var isSaving = false
    @State private var error: String?
    @State private var didRestoreDraft = false
    @State private var conflict: UserProfile?
    init(profile: UserProfileStore, value: UserProfile) {
        self.profile = profile
        _base = State(initialValue: value); _draft = State(initialValue: value)
    }
    private var dirty: Bool { draft.nickname != base.nickname || draft.signature != base.signature || draft.avatarMediaId != base.avatarMediaId }
    private var invalid: Bool {
        let nickname = draft.nickname.trimmingCharacters(in: .whitespacesAndNewlines)
        return nickname.isEmpty || nickname.unicodeScalars.count > 30 || draft.signature.unicodeScalars.count > 40 || (nickname + draft.signature).unicodeScalars.contains { CharacterSet.controlCharacters.contains($0) || $0.properties.generalCategory == .format }
    }
    var body: some View {
        Form {
            Section {
                VStack(spacing: 12) {
                    PhotosPicker(selection: $photo, matching: .images, preferredItemEncoding: .compatible) {
                        VStack(spacing: 12) {
                            UserAvatar(mediaID: draft.avatarMediaId, size: 104)
                            Text("更换头像")
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("更换你的头像")
                    if isImporting { ProgressView("正在读取图片") }
                }
                .frame(maxWidth: .infinity).padding(.vertical, 20)
                .listRowBackground(Color.clear)
            }
            Section {
                LabeledContent("昵称") {
                    TextField("你的昵称", text: $draft.nickname)
                        .multilineTextAlignment(.trailing).textInputAutocapitalization(.never).autocorrectionDisabled()
                        .accessibilityLabel("昵称")
                }
                LabeledContent("签名") {
                    TextField("一句话介绍自己", text: $draft.signature)
                        .multilineTextAlignment(.trailing).submitLabel(.done)
                        .accessibilityLabel("签名")
                }
            } footer: { Text("昵称1–30字，签名最多40字，请使用单行文字。") }
            if let error { Section { Text(error).foregroundStyle(.red) } }
            if isSaving { Section { ProgressView("正在保存") } }
        }
        .disabled(isSaving || isImporting)
        .navigationTitle("修改个人信息")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("保存") { Task { await save() } }
                    .disabled(!dirty || invalid || isSaving || isImporting)
            }
        }
        .task(id: photo) {
            guard let photo else { return }
            isImporting = true
            defer { isImporting = false; self.photo = nil }
            do {
                guard let data = try await photo.loadTransferable(type: Data.self) else { throw FantoAPIError.invalidResponse }
                let source = try await AvatarImageProcessor.prepare(data)
                try Task.checkCancellation(); cropSource = source
            } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
        }
        .fullScreenCover(item: $cropSource) { source in
            AvatarCropView(source: source, uploadPurpose: "user_avatar") { id in draft.avatarMediaId = id }
        }
        .alert("个人信息已在其他地方更新", isPresented: Binding(get: { conflict != nil }, set: { if !$0 { conflict = nil } }), presenting: conflict) { remote in
            Button("保留我的修改，重新保存") {
                base = remote; conflict = nil
            }
            Button("使用远端信息", role: .destructive) {
                base = remote; draft = remote; profile.accept(remote); conflict = nil
            }
            Button("取消", role: .cancel) { conflict = nil }
        } message: { _ in Text("请选择保留哪一份。本地草稿尚未覆盖远端信息。") }
        .onDisappear { profile.editDraft = dirty ? (base, draft) : nil }
        .onAppear {
            guard !didRestoreDraft else { return }
            didRestoreDraft = true
            if let saved = profile.editDraft { base = saved.base; draft = saved.value }
        }
    }
    private func save() async {
        guard !isSaving, !invalid else { return }
        isSaving = true; error = nil
        defer { isSaving = false }
        draft.nickname = draft.nickname.trimmingCharacters(in: .whitespacesAndNewlines)
        draft.signature = draft.signature.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            let value = try await FantoAPIClient.shared.updateUserProfile(version: base.version, changes: .init(nickname: draft.nickname, signature: draft.signature, avatarMediaId: draft.avatarMediaId))
            profile.accept(value); base = value; draft = value; profile.editDraft = nil; dismiss()
        } catch {
            if let remote = try? await FantoAPIClient.shared.fetchUserProfile() {
                if remote.nickname == draft.nickname && remote.signature == draft.signature && remote.avatarMediaId == draft.avatarMediaId {
                    profile.accept(remote); base = remote; draft = remote; profile.editDraft = nil; dismiss(); return
                }
                if remote.version != base.version { conflict = remote; return }
            }
            self.error = "保存失败，修改已保留，请重试。"
        }
    }
}
