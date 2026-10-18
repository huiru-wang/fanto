import SwiftUI
struct FantoBasicInfoView: View {
    @Bindable var editor: FantoSettingsEditor
    @FocusState private var focused: Bool
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("昵称").font(.headline)
                TextField("Fanto", text: $editor.draft.nickname).textFieldStyle(.roundedBorder).focused($focused)
                Text("简介").font(.headline)
                TextEditor(text: $editor.draft.description).font(.body).scrollContentBackground(.hidden).frame(height: 140).clipped().focused($focused)
                    .padding(12).background(.background, in: RoundedRectangle(cornerRadius: 20))
                Text("昵称最多 30 字，简介最多 300 字。返回设置首页后统一保存。") .font(.footnote).foregroundStyle(.secondary)
            }.padding(20)
        }
        .background(Color(.systemGroupedBackground))
        .scrollDismissesKeyboard(.interactively)
        .disabled(editor.isSaving)
        .navigationTitle("基本资料")
        .navigationBarBackButtonHidden(false)
        .toolbar { ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("收起键盘") { focused = false } } }
    }
}
