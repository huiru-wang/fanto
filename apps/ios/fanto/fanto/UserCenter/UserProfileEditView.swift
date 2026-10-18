import SwiftUI
import PhotosUI

struct UserProfileEditView: View {
    @Bindable var profile: UserProfileStore
    @State private var coverPhoto: PhotosPickerItem?
    @State private var croppingCover = false
    @State private var photo: PhotosPickerItem?
    @State private var cropSource: AvatarSource?
    @State private var originalMediaID: String?
    @State private var isImporting = false
    @State private var error: String?

    var body: some View {
        Form {
            if let value = profile.profile {
                Section {
                    VStack(spacing: 12) {
                        PhotosPicker(selection: $photo, matching: .images, preferredItemEncoding: .compatible) {
                            VStack(spacing: 12) {
                                UserAvatar(mediaID: value.avatarMediaId, size: 104)
                                Text("更换头像")
                            }
                        }
                        .buttonStyle(.plain)
                        .overlay {
                            if isImporting {
                                ProgressView().padding(8).background(.regularMaterial, in: Circle())
                                    .accessibilityLabel("正在读取图片")
                            }
                        }
                        .accessibilityLabel("更换你的头像")
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 20).listRowBackground(Color.clear)
                }
                Section {
                    NavigationLink {
                        SettingTextEditor(title: "修改昵称", value: value.nickname, limit: 30, required: true) { text, original in
                            try await profile.save(.nickname, value: text, original: original)
                        }
                    } label: { LabeledContent("昵称", value: value.nickname) }
                    NavigationLink {
                        SettingTextEditor(title: "修改签名", value: value.signature, limit: 40) { text, original in
                            try await profile.save(.signature, value: text, original: original)
                        }
                    } label: { LabeledContent("签名", value: value.signature.isEmpty ? "未设置" : value.signature) }
                    PhotosPicker(selection: $coverPhoto, matching: .images, preferredItemEncoding: .compatible) {
                        HStack {
                            Text("背景图").foregroundStyle(.primary)
                            Spacer()
                            UserCover(mediaID: value.coverMediaId)
                                .frame(width: 52, height: 40).clipped()
                                .clipShape(RoundedRectangle(cornerRadius: 6)).accessibilityHidden(true)
                            Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
                        }.contentShape(Rectangle())
                    }
                    .buttonStyle(.plain).accessibilityLabel("更换背景图")
                    if let cover = value.coverMediaId {
                        Button("使用默认背景图") {
                            Task {
                                do { try await profile.save(.coverMediaId, value: nil, original: cover); error = nil }
                                catch { self.error = error.localizedDescription }
                            }
                        }
                    }
                }
            }
            if let error { Section { Text(error).foregroundStyle(.red) } }
        }
        .disabled(profile.isSaving || isImporting)
        .navigationTitle("修改个人信息").navigationBarTitleDisplayMode(.inline)
        .task(id: photo) { await importPhoto(photo, cover: false) }
        .task(id: coverPhoto) { await importPhoto(coverPhoto, cover: true) }
        .fullScreenCover(item: $cropSource) { source in
            AvatarCropView(source: source, uploadPurpose: croppingCover ? "user_cover" : "user_avatar") { id in
                try await profile.save(croppingCover ? .coverMediaId : .avatarMediaId, value: id, original: originalMediaID)
            }
        }
    }

    private func importPhoto(_ item: PhotosPickerItem?, cover: Bool) async {
        guard let item else { return }
        isImporting = true; error = nil
        originalMediaID = cover ? profile.profile?.coverMediaId : profile.profile?.avatarMediaId
        defer { isImporting = false; if cover { coverPhoto = nil } else { photo = nil } }
        do {
            guard let data = try await item.loadTransferable(type: Data.self) else { throw FantoAPIError.invalidResponse }
            let source = try await AvatarImageProcessor.prepare(data)
            try Task.checkCancellation()
            guard !cover || source.image.width >= 640 && source.image.height >= 480 else {
                throw FantoAPIError.server("请选择至少640×480像素的背景图。", code: nil)
            }
            croppingCover = cover; cropSource = source
        } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }
}
