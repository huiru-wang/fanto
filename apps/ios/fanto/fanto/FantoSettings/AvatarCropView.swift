import SwiftUI

struct AvatarCropView: View {
    let source: AvatarSource
    var uploadPurpose = "fanto_avatar"
    let saveAvatar: (String) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var zoom: CGFloat = 1
    @State private var offset = CGSize.zero
    @State private var lastDragTranslation = CGSize.zero
    @State private var zoomOrigin: CGFloat?
    @State private var stage: String?
    @State private var error: String?
    @State private var upload: DraftMediaUpload?
    @State private var uploadProgress: MediaUploadProgress?
    @State private var operation: Task<Void, Never>?

    private var isCover: Bool { uploadPurpose == "user_cover" }
    private var aspect: CGFloat { isCover ? 4 / 3 : 1 }
    private var maximumZoom: CGFloat { isCover ? min(5, CGFloat(source.image.width) / 640, CGFloat(source.image.height) / 480) : min(5, CGFloat(min(source.image.width, source.image.height)) / 128) }

    var body: some View {
        NavigationStack {
            GeometryReader { geometry in
                let diameter = max(80, min(geometry.size.width - 40, geometry.size.height * 0.56, 460))
                VStack(spacing: 20) {
                    Text(isCover ? "拖动或缩放图片，确认背景范围" : uploadPurpose == "user_avatar" ? "拖动或缩放图片，确认头像范围" : "拖动或缩放图片，保存后立即更新头像").font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
                    Spacer(minLength: 0)
                    crop(diameter: diameter)
                    Spacer(minLength: 0)
                    HStack {
                        Image(systemName: "minus.magnifyingglass")
                        Slider(value: $zoom, in: 1...max(1.001, maximumZoom)) { editing in
                            if !editing { constrain(diameter) }
                        }
                        .tint(FantoTheme.accent)
                        .accessibilityLabel(isCover ? "背景图缩放" : "头像缩放")
                        .onChange(of: zoom) { _, _ in constrain(diameter); invalidateUpload() }
                        Image(systemName: "plus.magnifyingglass")
                    }
                    .disabled(stage != nil || maximumZoom <= 1)
                    Button("重置构图") { zoom = 1; offset = .zero; invalidateUpload() }
                        .buttonStyle(.glass).tint(FantoTheme.accent)
                        .disabled(stage != nil)

                }
                .padding(20)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .navigationTitle(isCover ? "调整背景图" : "调整头像")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("取消", systemImage: "chevron.left") { dismiss() }
                            .labelStyle(.iconOnly).disabled(stage != nil)
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        Button { beginSave(diameter) } label: {
                            ZStack {
                                Image(systemName: "checkmark").opacity(stage == nil ? 1 : 0)
                                if stage != nil { ProgressView() }
                            }.frame(width: 24, height: 24)
                        }
                        .disabled(stage != nil)
                        .accessibilityLabel(stage ?? "保存")
                    }
                }
                .onChange(of: diameter) { _, _ in constrain(diameter) }
            }
        }
        .tint(.primary)
        .background(.black)
        .preferredColorScheme(.dark)
        .interactiveDismissDisabled(stage != nil)
        .onDisappear { operation?.cancel() }
        .alert("图片保存失败", isPresented: Binding(
            get: { error != nil }, set: { if !$0 { error = nil } }
        )) {
            Button("好", role: .cancel) { error = nil }
        } message: { Text(error ?? "请稍后重试。") }
    }

    private func crop(diameter: CGFloat) -> some View {
        let scale = max(diameter / CGFloat(source.image.width), diameter / aspect / CGFloat(source.image.height)) * zoom
        return Color.black
            .frame(width: diameter, height: diameter / aspect)
            .overlay {
                Image(decorative: source.image, scale: 1)
                    .resizable()
                    .frame(width: CGFloat(source.image.width) * scale, height: CGFloat(source.image.height) * scale)
                    .offset(offset)
            }
            .overlay {
                Rectangle().fill(.black.opacity(0.6))
                    .mask {
                        Rectangle().overlay {
                            Group {
                                if isCover { RoundedRectangle(cornerRadius: 12) } else { Circle() }
                            }.blendMode(.destinationOut)
                        }.compositingGroup()
                    }
            }
            .overlay {
                if isCover { RoundedRectangle(cornerRadius: 12).stroke(.white, lineWidth: 1) }
                else { Circle().stroke(.white, lineWidth: 1) }
            }
            .clipped()
        .contentShape(Rectangle())
        .gesture(DragGesture().onChanged { value in
            guard stage == nil else { return }
            offset.width += value.translation.width - lastDragTranslation.width
            offset.height += value.translation.height - lastDragTranslation.height
            lastDragTranslation = value.translation
            constrain(diameter); invalidateUpload()
        }.onEnded { _ in lastDragTranslation = .zero })
        .simultaneousGesture(MagnifyGesture().onChanged { value in
            guard stage == nil else { return }
            if zoomOrigin == nil { zoomOrigin = zoom }
            let next = max(1, min(maximumZoom, zoomOrigin! * value.magnification))
            let ratio = next / zoom
            let anchor = value.startAnchor
            offset.width = offset.width * ratio + (anchor.x - 0.5) * diameter * (1 - ratio)
            offset.height = offset.height * ratio + (anchor.y - 0.5) * diameter / aspect * (1 - ratio)
            zoom = next; constrain(diameter); invalidateUpload()
        }.onEnded { _ in zoomOrigin = nil })
        .accessibilityElement()
        .accessibilityLabel(isCover ? "背景图裁剪区域" : "头像裁剪区域")
        .accessibilityHint("可使用缩放滑块及方向操作调整构图")
        .accessibilityAction(named: "向左移动") { offset.width -= 12; constrain(diameter); invalidateUpload() }
        .accessibilityAction(named: "向右移动") { offset.width += 12; constrain(diameter); invalidateUpload() }
        .accessibilityAction(named: "向上移动") { offset.height -= 12; constrain(diameter); invalidateUpload() }
        .accessibilityAction(named: "向下移动") { offset.height += 12; constrain(diameter); invalidateUpload() }
    }
    private func constrain(_ diameter: CGFloat) {
        let scale = max(diameter / CGFloat(source.image.width), diameter / aspect / CGFloat(source.image.height)) * zoom
        let x = max(0, (CGFloat(source.image.width) * scale - diameter) / 2)
        let y = max(0, (CGFloat(source.image.height) * scale - diameter / aspect) / 2)
        offset = CGSize(width: max(-x, min(x, offset.width)), height: max(-y, min(y, offset.height)))
    }
    private func invalidateUpload() { guard stage == nil else { return }; upload = nil; uploadProgress = nil }
    private func beginSave(_ diameter: CGFloat) {
        guard stage == nil else { return }
        stage = isCover ? "正在生成背景图…" : "正在生成头像…"; error = nil
        let cacheScope = AccountCache.shared.scope
        operation = Task {
            defer { stage = nil }
            do {
                if upload == nil {
                    let (data, side) = try await AvatarImageProcessor.export(source.image, side: diameter, offset: offset, zoom: zoom, cover: isCover)
                    try Task.checkCancellation()
                    upload = DraftMediaUpload(data: data, mimeType: "image/jpeg", capture: .init(width: side, height: isCover ? side * 3 / 4 : side))
                }
                guard let upload else { return }
                stage = isCover ? "正在上传背景图…" : "正在上传头像…"
                let id = try await MediaUploadAPIClient.shared.upload(upload, purpose: uploadPurpose, progress: uploadProgress) { uploadProgress = $0 }
                try Task.checkCancellation()
                stage = isCover ? "正在保存背景图…" : "正在保存头像…"
                if let cacheScope {
                    await MediaImageCache.shared.seed(upload.data, id: id, variants: [.original, .thumbnail], scope: cacheScope)
                }
                try Task.checkCancellation()
                guard AccountCache.shared.scope == cacheScope else { throw CancellationError() }
                try await saveAvatar(id)
                dismiss()
            } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
        }
    }
}
