import SwiftUI

private struct UserInputDraft {
    var selections: [String: Set<String>] = [:]
    var otherValues: [String: String] = [:]
    var textValues: [String: String] = [:]

    func answer(for question: FantoUserInputQuestion) -> String? {
        switch question.type {
        case .text:
            let value = textValues[question.id]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return value.isEmpty ? nil : value
        case .singleSelect, .multiSelect:
            var labels = (question.options ?? [])
                .filter { selections[question.id]?.contains($0.value) == true }
                .map(\.label)
            let other = otherValues[question.id]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if !other.isEmpty { labels.append(other) }
            return labels.isEmpty ? nil : labels.joined(separator: "、")
        }
    }
}

struct UserInputFormCard: View {
    let request: FantoUserInputRequest
    let submit: (FantoUserInputRequest, [String]) -> Void

    @State private var draft = UserInputDraft()

    private var answers: [String]? {
        let values = request.questions.compactMap { draft.answer(for: $0) }
        return values.count == request.questions.count ? values : nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: request.isResolved ? "checkmark.circle.fill" : "questionmark.circle.fill")
                    .font(.title3)
                    .foregroundStyle(request.isResolved ? .green : FantoTheme.accent)
                VStack(alignment: .leading, spacing: 3) {
                    Text(request.isResolved ? "已补充信息" : request.title)
                        .font(.headline)
                    if let description = request.description, !description.isEmpty {
                        Text(description)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            if !request.isResolved {
                ForEach(request.questions) { question in
                    questionView(question)
                }

                Button {
                    guard let answers else { return }
                    submit(request, answers)
                } label: {
                    Text("提交")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(answers == nil)
                .accessibilityHint("提交后会继续这段对话")
            }
        }
        .padding(16)
        .background(.background, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(FantoTheme.accent.opacity(request.isResolved ? 0.18 : 0.32), lineWidth: 1)
        }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private func questionView(_ question: FantoUserInputQuestion) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(question.label)
                .font(.subheadline.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)

            switch question.type {
            case .text:
                if question.multiline == true {
                    TextField(question.placeholder ?? "请输入", text: textBinding(for: question.id), axis: .vertical)
                        .lineLimit(3 ... 6)
                        .textFieldStyle(.roundedBorder)
                } else {
                    TextField(question.placeholder ?? "请输入", text: textBinding(for: question.id))
                        .lineLimit(1)
                        .textFieldStyle(.roundedBorder)
                }
            case .singleSelect:
                optionList(question, allowsMultipleSelection: false)
            case .multiSelect:
                optionList(question, allowsMultipleSelection: true)
            }
        }
    }

    @ViewBuilder
    private func optionList(_ question: FantoUserInputQuestion, allowsMultipleSelection: Bool) -> some View {
        VStack(spacing: 8) {
            ForEach(question.options ?? []) { option in
                Button {
                    updateSelection(option.value, for: question.id, allowsMultipleSelection: allowsMultipleSelection)
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: isSelected(option.value, questionID: question.id)
                            ? (allowsMultipleSelection ? "checkmark.square.fill" : "largecircle.fill.circle")
                            : (allowsMultipleSelection ? "square" : "circle"))
                            .foregroundStyle(isSelected(option.value, questionID: question.id) ? FantoTheme.accent : .secondary)
                        Text(option.label)
                            .foregroundStyle(.primary)
                            .multilineTextAlignment(.leading)
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .background(isSelected(option.value, questionID: question.id) ? FantoTheme.softAccent : Color(uiColor: .tertiarySystemFill), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(.plain)
                .accessibilityValue(isSelected(option.value, questionID: question.id) ? "已选择" : "未选择")
            }

            if question.allowOther == true {
                TextField("其他，请填写", text: otherBinding(for: question.id), axis: .vertical)
                    .lineLimit(1 ... 3)
                    .textFieldStyle(.roundedBorder)
            }
        }
    }

    private func isSelected(_ value: String, questionID: String) -> Bool {
        draft.selections[questionID]?.contains(value) == true
    }

    private func updateSelection(_ value: String, for questionID: String, allowsMultipleSelection: Bool) {
        if allowsMultipleSelection {
            var values = draft.selections[questionID] ?? []
            if values.contains(value) { values.remove(value) } else { values.insert(value) }
            draft.selections[questionID] = values
        } else {
            draft.selections[questionID] = draft.selections[questionID] == [value] ? [] : [value]
        }
    }

    private func textBinding(for id: String) -> Binding<String> {
        Binding(get: { draft.textValues[id, default: ""] }, set: { draft.textValues[id] = $0 })
    }

    private func otherBinding(for id: String) -> Binding<String> {
        Binding(get: { draft.otherValues[id, default: ""] }, set: { draft.otherValues[id] = $0 })
    }
}
