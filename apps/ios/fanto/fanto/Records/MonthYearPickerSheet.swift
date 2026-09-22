import SwiftUI

struct MonthYearPickerSheet: View {
    let date: Date
    let select: (Int, Int) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var year: Int
    @State private var month: Int

    private let calendar = Calendar.current

    init(date: Date, select: @escaping (Int, Int) -> Void) {
        self.date = date
        self.select = select
        _year = State(initialValue: Calendar.current.component(.year, from: date))
        _month = State(initialValue: Calendar.current.component(.month, from: date))
    }

    var body: some View {
        NavigationStack {
            HStack(spacing: 0) {
                Picker("年份", selection: $year) {
                    ForEach(years, id: \.self) { value in
                        Text("\(value) 年").tag(value)
                    }
                }
                .pickerStyle(.wheel)
                .accessibilityLabel("年份")

                Picker("月份", selection: $month) {
                    ForEach(1...12, id: \.self) { value in
                        Text("\(value) 月").tag(value)
                    }
                }
                .pickerStyle(.wheel)
                .accessibilityLabel("月份")
            }
            .navigationTitle("选择年月")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消", action: dismiss.callAsFunction)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") {
                        select(year, month)
                        dismiss()
                    }
                }
            }
        }
    }

    private var years: ClosedRange<Int> {
        let currentYear = calendar.component(.year, from: .now)
        return 1900...max(currentYear + 10, year + 1)
    }
}
