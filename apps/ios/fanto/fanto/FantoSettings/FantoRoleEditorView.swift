import SwiftUI
struct FantoRoleEditorView: View {
    @Bindable var editor: FantoSettingsEditor
    let field: String
    let title: String
    @FocusState private var focused: Bool
    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    TextEditor(text: $editor.draft.roleConfig[field])
                        .font(.body)
                        .scrollContentBackground(.hidden)
                        .frame(height: max(140, geometry.size.height - 140))
                        .clipped()
                        .padding(12)
                        .background(.background, in: RoundedRectangle(cornerRadius: 20))
                        .focused($focused)
                        .accessibilityLabel(title)
                    Text(field == "character" ? "留空使用默认交流风格。返回设置首页后统一保存。" : "返回设置首页后统一保存，每项最多 16,000 字符。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                .padding(20)
            }
            .background(Color(.systemGroupedBackground))
            .scrollDismissesKeyboard(.interactively)
        }
        .disabled(editor.isSaving)
        .navigationTitle(title)
        .navigationBarBackButtonHidden(false)
        .toolbar { ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("收起键盘") { focused = false } } }
    }
}
