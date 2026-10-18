import SwiftUI

struct SaveSettingButton: View {
    let enabled: Bool
    let action: () -> Void
    var body: some View {
        Button("保存", systemImage: "checkmark", action: action)
            .labelStyle(.iconOnly)
            .foregroundStyle(enabled ? Color.primary : Color.secondary)
            .disabled(!enabled)
    }
}

/// Each destination owns only one field's draft and baseline.
struct SettingTextEditor: View {
    let title: String
    let limit: Int
    var multiline = false
    var required = false
    let save: (String, String) async throws -> Void
    @State private var original: String
    @State private var text: String
    @State private var isSaving = false
    @State private var isVisible = false
    @State private var error: String?
    @State private var conflict: SettingFieldConflict?
    @FocusState private var focused: Bool
    @Environment(\.dismiss) private var dismiss

    init(title: String, value: String, limit: Int, multiline: Bool = false, required: Bool = false,
         save: @escaping (String, String) async throws -> Void) {
        self.title = title; self.limit = limit; self.multiline = multiline; self.required = required; self.save = save
        _original = State(initialValue: value); _text = State(initialValue: value)
    }
    private var submitted: String { multiline ? text : text.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var valid: Bool {
        (multiline ? submitted.utf16.count : submitted.unicodeScalars.count) <= limit && (!required || !submitted.isEmpty) &&
        (multiline || !submitted.unicodeScalars.contains { CharacterSet.controlCharacters.contains($0) || $0.properties.generalCategory == .format })
    }
    private var canSave: Bool { submitted != original && valid && !isSaving }

    var body: some View {
        Form {
            Section {
                if multiline {
                    TextEditor(text: $text)
                        .font(.body).tint(FantoTheme.accent).focused($focused)
                        .frame(minHeight: 220, maxHeight: 360)
                        .accessibilityLabel(title)
                } else {
                    HStack {
                        TextField(title, text: $text)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                            .tint(FantoTheme.accent).focused($focused).submitLabel(.done)
                            .onSubmit { focused = false }
                        Text("\(text.unicodeScalars.count)/\(limit)")
                            .font(.footnote).foregroundStyle(valid ? Color.secondary : .red)
                            .monospacedDigit().accessibilityLabel("\(text.unicodeScalars.count) 字，最多 \(limit) 字")
                    }
                }
            } footer: {
                Text(multiline ? "最多 \(limit) 字符。" : required ? "请输入 1–\(limit) 字的单行文字。" : "最多 \(limit) 字，请使用单行文字。")
            }
            if let error { Section { Text(error).foregroundStyle(.red) } }
        }
        .disabled(isSaving)
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle(title).navigationBarTitleDisplayMode(.inline)
        .onAppear { isVisible = true }
        .onDisappear { isVisible = false }
        .toolbar {
            // Ordinary toolbar placement keeps the same native glass background in both states.
            ToolbarItem(placement: .topBarTrailing) {
                SaveSettingButton(enabled: canSave) { Task { await commit() } }
            }
            ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("收起键盘") { focused = false } }
        }
        .alert("这一项已更新", isPresented: Binding(get: { conflict != nil }, set: { if !$0 { conflict = nil } }), presenting: conflict) { latest in
            Button("使用最新内容") { original = latest.remoteValue ?? ""; text = original; conflict = nil; error = nil }
            Button("保留我的修改") { original = latest.remoteValue ?? ""; conflict = nil; error = nil }
            Button("取消", role: .cancel) { conflict = nil }
        } message: { _ in Text("保留修改后，请再次点击对勾确认保存。") }
    }
    private func commit() async {
        guard canSave else { return }
        focused = false; isSaving = true; error = nil
        defer { isSaving = false }
        do {
            try await save(submitted, original)
            if isVisible { dismiss() }
        }
        catch let changed as SettingFieldConflict { conflict = changed }
        catch { if !(error is CancellationError) { self.error = error.localizedDescription } }
    }
}
