import SwiftUI

struct RecordDatePickerView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var selectedDate: Date
    @State private var selectedTime: Date
    let onSave: (Date) -> Void

    init(date: Date, onSave: @escaping (Date) -> Void) {
        _selectedDate = State(initialValue: date)
        _selectedTime = State(initialValue: date)
        self.onSave = onSave
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    DatePicker("记录日期", selection: $selectedDate, displayedComponents: .date)
                        .datePickerStyle(.graphical).tint(FantoTheme.accent)

                    DatePicker("记录时间", selection: $selectedTime, displayedComponents: .hourAndMinute)
                        .datePickerStyle(.compact).tint(FantoTheme.accent)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(.quaternary.opacity(0.4), in: .rect(cornerRadius: 16))
                }
                .padding(.horizontal, 20)
                .padding(.top, 20)
            }
            .navigationTitle("选择日期与时间")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("完成", systemImage: "checkmark") {
                        var components = Calendar.current.dateComponents([.year, .month, .day], from: selectedDate)
                        let time = Calendar.current.dateComponents([.hour, .minute], from: selectedTime)
                        components.hour = time.hour
                        components.minute = time.minute
                        components.second = 0
                        onSave(Calendar.current.date(from: components) ?? selectedDate)
                        dismiss()
                    }.labelStyle(.iconOnly)
                }
            }
        }
        .tint(.primary)
        .environment(\.locale, Locale(identifier: "zh_CN"))
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }
}
