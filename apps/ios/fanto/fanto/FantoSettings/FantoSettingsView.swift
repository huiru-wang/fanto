import SwiftUI
import PhotosUI

struct FantoSettingsView: View {
    @Bindable var profile: FantoSettingsStore
    @State private var photo: PhotosPickerItem?
    @State private var cropSource: AvatarSource?
    @State private var avatarOriginal: String?
    @State private var isImporting = false
    @State private var error: String?
    @State private var confirmingClearHistory = false

    var body: some View {
        Group {
            if let value = profile.settings {
                List {
                    Section {
                        VStack(spacing: 12) {
                            PhotosPicker(selection: $photo, matching: .images, preferredItemEncoding: .compatible) {
                                ConversationAvatar(isFanto: true, size: 88, personalized: true)
                            }
                            .buttonStyle(.plain)
                            .overlay {
                                if isImporting {
                                    ProgressView().padding(8).background(.regularMaterial, in: Circle())
                                        .accessibilityLabel("正在读取图片")
                                }
                            }
                            .accessibilityLabel("选择新的 Fanto 头像")
                            .disabled(profile.isSaving || isImporting)
                            Text(value.nickname).font(.title2.bold())
                        }
                        .frame(maxWidth: .infinity).padding(.vertical, 16)
                        .listRowBackground(Color.clear)
                    }
                    Section {
                        NavigationLink {
                            SettingTextEditor(title: "修改昵称", value: value.nickname, limit: 30, required: true) { text, original in
                                try await profile.saveText(field: "nickname", value: text, original: original)
                            }
                        } label: { LabeledContent("昵称", value: value.nickname) }
                    }
                    Section {
                        roleLink("角色设定", field: "character", value: value)
                        roleLink("互动场景", field: "scenario", value: value)
                        roleLink("交流规则", field: "instructions", value: value)
                        roleLink("示例对话", field: "exampleDialogues", value: value)
                    }
                    Section {
                        PendingSettingsLink(title: "记忆管理", symbol: "brain")
                    }
                    Section {
                        Button("清除对话记录", role: .destructive) { confirmingClearHistory = true }
                    }
                    if let error { Section { Text(error).foregroundStyle(.red) } }
                }
            } else if profile.isLoading {
                ProgressView("正在读取设置")
            } else {
                ContentUnavailableView {
                    Label("暂时无法读取设置", systemImage: "wifi.exclamationmark")
                } description: { Text(profile.errorMessage ?? "请稍后重试") }
                actions: { Button("重新读取") { Task { await profile.load(force: true) } } }
            }
        }
        .navigationTitle("Fanto 设置").navigationBarTitleDisplayMode(.inline)
        .alert("清除对话记录？", isPresented: $confirmingClearHistory) {
            Button("清除对话记录", role: .destructive) {
                // Confirmation UI only until the user-facing deletion API is implemented.
            }
            Button("取消", role: .cancel) { }
        } message: {
            Text("此功能尚未开放，暂不会删除任何数据。开放后，清除操作不可撤销，记忆将保留。")
        }
        .task { await profile.load() }
        .task(id: photo) {
            guard let photo else { return }
            avatarOriginal = profile.settings?.avatarMediaId
            isImporting = true; error = nil
            defer { isImporting = false; self.photo = nil }
            do {
                guard let data = try await photo.loadTransferable(type: Data.self) else { throw FantoAPIError.invalidResponse }
                let source = try await AvatarImageProcessor.prepare(data)
                try Task.checkCancellation(); cropSource = source
            } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
        }
        .fullScreenCover(item: $cropSource) { source in
            AvatarCropView(source: source) { id in try await profile.saveAvatar(id, original: avatarOriginal) }
        }
    }
    private func roleLink(_ title: String, field: String, value: FantoSettings) -> some View {
        NavigationLink {
            FantoRoleEditorView(profile: profile, field: field, title: title, value: value.roleConfig[field])
        } label: { Text(title) }
    }
}
