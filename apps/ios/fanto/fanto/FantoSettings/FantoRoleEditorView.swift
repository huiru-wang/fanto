import SwiftUI

struct FantoRoleEditorView: View {
    let profile: FantoSettingsStore
    let field: String
    let title: String
    let value: String
    private var guidance: String {
        switch field {
        case "character": "人物身份、性格、习惯、目标与语言风格；留空使用默认角色。"
        case "scenario": "世界背景、与用户的初始关系、常见互动环境。"
        case "instructions": "希望怎样交流、动作描写多少及互动边界。角色说话不需要引号。"
        case "exampleDialogues": "用几段对话示范语气；动作以 > 开头，话语直接写，不加引号。"
        default: ""
        }
    }
    var body: some View {
        SettingTextEditor(title: title, value: value, limit: 16_000, multiline: true, guidance: guidance) { text, original in
            try await profile.saveText(field: field, value: text, original: original)
        }
    }
}
