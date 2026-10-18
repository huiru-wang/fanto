import SwiftUI

struct FantoRoleEditorView: View {
    let profile: FantoSettingsStore
    let field: String
    let title: String
    let value: String
    var body: some View {
        SettingTextEditor(title: title, value: value, limit: 16_000, multiline: true) { text, original in
            try await profile.saveText(field: field, value: text, original: original)
        }
    }
}
