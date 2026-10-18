import SwiftUI
import PhotosUI

struct FantoSettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var editor: FantoSettingsEditor
    @State private var photo: PhotosPickerItem?
    @State private var cropSource: AvatarSource?
    @State private var isImporting = false
    @State private var confirmDiscard = false
    init(profile: FantoSettingsStore) { _editor = State(initialValue: FantoSettingsEditor(profile: profile)) }

    var body: some View {
        Group {
            if editor.saved == nil {
                VStack(spacing: 16) {
                    if editor.isLoading { ProgressView("正在读取设置") }
                    else {
                        ContentUnavailableView("暂时无法读取设置", systemImage: "wifi.exclamationmark", description: Text(editor.errorMessage ?? "请稍后重试"))
                        Button("重新读取") { Task { await editor.load() } }
                    }
                }
            } else { settingsList }
        }
        .navigationTitle("Fanto 设置")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(true)
        .toolbar(.hidden, for: .tabBar)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("返回", systemImage: "chevron.left") { if editor.hasChanges { confirmDiscard = true } else { dismiss() } }
                    .disabled(editor.isSaving || isImporting)
                    .confirmationDialog("放弃未保存的文字设置？已保存的头像不会撤销。", isPresented: $confirmDiscard, titleVisibility: .visible) {
                        Button("放弃文字修改", role: .destructive) { dismiss() }
                        Button("继续编辑", role: .cancel) { }
                    }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button("保存") { Task { _ = await editor.saveText() } }
                    .disabled(!editor.hasChanges || editor.invalidText || editor.isSaving || isImporting || !editor.conflicts.isEmpty)
            }
        }
        .task { await editor.load() }
        .task(id: photo) {
            guard let photo else { return }
            isImporting = true
            defer { isImporting = false; self.photo = nil }
            do {
                guard let data = try await photo.loadTransferable(type: Data.self) else { throw FantoAPIError.invalidResponse }
                let source = try await AvatarImageProcessor.prepare(data)
                try Task.checkCancellation()
                cropSource = source
            } catch { if !Task.isCancelled { editor.errorMessage = error.localizedDescription } }
        }
        .fullScreenCover(item: $cropSource) { source in
            AvatarCropView(source: source) { id in try await editor.saveAvatar(id) }
        }
    }

    private var settingsList: some View {
        List {
            Section {
                VStack(spacing: 12) {
                    PhotosPicker(selection: $photo, matching: .images, preferredItemEncoding: .compatible) {
                        ConversationAvatar(isFanto: true, size: 88, personalized: true)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("选择新的 Fanto 头像")
                    .disabled(editor.isSaving || isImporting)
                    Text(editor.draft.nickname).font(.title2.bold())
                    if !editor.draft.description.isEmpty { Text(editor.draft.description).font(.subheadline).foregroundStyle(.secondary) }
                    if isImporting { ProgressView("正在读取图片") }
                    Text("点击头像选择图片，裁剪保存后立即生效")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
                .listRowBackground(Color.clear)
            }
            Section {
                NavigationLink("基本资料") { FantoBasicInfoView(editor: editor) }
                if editor.saved?.avatarMediaId != nil {
                    Button("恢复默认头像") { Task { do { try await editor.saveAvatar(nil) } catch { editor.errorMessage = error.localizedDescription } } }
                        .disabled(editor.isSaving || isImporting)
                }
            }
            Section("角色设定") {
                roleLink("角色与性格", key: "character")
                roleLink("互动场景", key: "scenario")
                roleLink("交流规则", key: "instructions")
                roleLink("示例对话", key: "exampleDialogues")
            }
            if !editor.conflicts.isEmpty {
                Section {
                    Label("部分文字在其他地方也有修改，请选择保留哪一份。", systemImage: "exclamationmark.triangle")
                    Button("保留我的文字，稍后保存") { editor.resolveConflicts(useLocal: true) }
                    Button("使用全部远端文字", role: .destructive) { editor.resolveConflicts(useLocal: false) }
                }
            }
            Section {
                if let error = editor.errorMessage { Text(error).foregroundStyle(.red) }
                if editor.isSaving { ProgressView("正在保存") }
                Text("文字修改需点击页面保存；角色设置从下一轮主对话生效。")
                    .foregroundStyle(.secondary)
            }
            .font(.footnote)
        }
    }
    private func roleLink(_ title: String, key: String) -> some View {
        NavigationLink {
            FantoRoleEditorView(editor: editor, field: key, title: title)
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                Text(title)
                Text(editor.draft.roleConfig[key].isEmpty ? (key == "character" ? "默认交流风格" : "未设置") : editor.draft.roleConfig[key])
                    .font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
            }
        }
        .disabled(editor.isSaving)
    }
}
