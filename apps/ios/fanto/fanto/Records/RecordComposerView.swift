import SwiftUI

struct RecordComposerView: View {
    @Environment(FantoStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    let didSave: (Date) -> Void
    @State private var text = ""
    @State private var includesLocation = false
    @State private var eventAt = Date.now

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("想到什么，就记下来。", text: $text, axis: .vertical)
                        .lineLimit(7...12)
                }

                Section("发生时间") {
                    DatePicker("发生时间", selection: $eventAt, displayedComponents: [.date, .hourAndMinute])
                        .datePickerStyle(.compact)
                }

                Section {
                    LabeledContent("附件") {
                        Label("即将支持", systemImage: "photo.on.rectangle")
                            .foregroundStyle(.secondary)
                    }
                    Toggle("添加当前位置", isOn: $includesLocation)
                } header: {
                    Text("添加到这条记录")
                } footer: {
                    Text("位置只会在你主动打开时保存。")
                }
            }
            .navigationTitle("新记录")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消", action: dismiss.callAsFunction)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("保存") {
                        store.addRecord(text: text, location: includesLocation ? "杭州 · 西湖区" : nil, eventAt: eventAt)
                        didSave(eventAt)
                        dismiss()
                    }
                    .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }
}
