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

    func answerOrSkipped(for question: FantoUserInputQuestion) -> String? {
        answer(for: question) ?? (question.isRequired ? nil : "未填写")
    }
}

struct UserInputPrompt: View {
    let request: FantoUserInputRequest
    let submit: (FantoUserInputRequest, [String]) -> Void

    @State private var currentIndex = 0
    @State private var draft = UserInputDraft()

    private var question: FantoUserInputQuestion { request.questions[currentIndex] }
    private var canContinue: Bool { draft.answerOrSkipped(for: question) != nil }
    private var isLastQuestion: Bool { currentIndex == request.questions.count - 1 }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: "questionmark.circle.fill")
                    .foregroundStyle(FantoTheme.accent)
                Text(request.title)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                Spacer(minLength: 8)
                Text("\(currentIndex + 1)/\(request.questions.count)")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }

            if let description = request.description, !description.isEmpty, currentIndex == 0 {
                Text(description)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Text(question.label)
                .font(.subheadline.weight(.semibold))
                .fixedSize(horizontal: false, vertical: true)

            questionContent

            HStack(spacing: 10) {
                if currentIndex > 0 {
                    Button("上一题") {
                        withAnimation(.easeInOut(duration: 0.16)) { currentIndex -= 1 }
                    }
                    .buttonStyle(.bordered)
                }

                Spacer()

                Button(isLastQuestion ? "提交" : "下一题") { advance() }
                    .buttonStyle(.borderedProminent)
                    .disabled(!canContinue)
            }
        }
        .padding(14)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(FantoTheme.accent.opacity(0.24), lineWidth: 1)
        }
        .shadow(color: .black.opacity(0.08), radius: 12, y: 5)
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var questionContent: some View {
        switch question.type {
        case .text:
            if question.multiline == true {
                TextField(question.placeholder ?? "请输入", text: textBinding(for: question.id), axis: .vertical)
                    .lineLimit(2 ... 4)
                    .textFieldStyle(.roundedBorder)
            } else {
                TextField(question.placeholder ?? "请输入", text: textBinding(for: question.id))
                    .textFieldStyle(.roundedBorder)
            }
        case .singleSelect:
            optionList(allowsMultipleSelection: false)
        case .multiSelect:
            optionList(allowsMultipleSelection: true)
        }
    }

    @ViewBuilder
    private func optionList(allowsMultipleSelection: Bool) -> some View {
        VStack(spacing: 6) {
            ForEach(question.options ?? []) { option in
                Button {
                    updateSelection(option.value, allowsMultipleSelection: allowsMultipleSelection)
                    if !allowsMultipleSelection, question.allowOther != true { advance() }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: isSelected(option.value)
                            ? (allowsMultipleSelection ? "checkmark.square.fill" : "largecircle.fill.circle")
                            : (allowsMultipleSelection ? "square" : "circle"))
                            .foregroundStyle(isSelected(option.value) ? FantoTheme.accent : .secondary)
                        Text(option.label)
                            .font(.footnote)
                            .foregroundStyle(.primary)
                            .multilineTextAlignment(.leading)
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .background(isSelected(option.value) ? FantoTheme.softAccent : Color(uiColor: .tertiarySystemFill), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
                .buttonStyle(.plain)
                .accessibilityValue(isSelected(option.value) ? "已选择" : "未选择")
            }

            if question.allowOther == true {
                TextField("其他，请填写", text: otherBinding(for: question.id))
                    .font(.footnote)
                    .textFieldStyle(.roundedBorder)
            }
        }
    }

    private func advance() {
        guard canContinue else { return }
        if isLastQuestion {
            let answers = request.questions.compactMap { draft.answerOrSkipped(for: $0) }
            guard answers.count == request.questions.count else { return }
            submit(request, answers)
        } else {
            withAnimation(.easeInOut(duration: 0.16)) { currentIndex += 1 }
        }
    }

    private func isSelected(_ value: String) -> Bool {
        draft.selections[question.id]?.contains(value) == true
    }

    private func updateSelection(_ value: String, allowsMultipleSelection: Bool) {
        if allowsMultipleSelection {
            var values = draft.selections[question.id] ?? []
            if values.contains(value) { values.remove(value) } else { values.insert(value) }
            draft.selections[question.id] = values
        } else {
            draft.selections[question.id] = draft.selections[question.id] == [value] ? [] : [value]
        }
    }

    private func textBinding(for id: String) -> Binding<String> {
        Binding(get: { draft.textValues[id, default: ""] }, set: { draft.textValues[id] = $0 })
    }

    private func otherBinding(for id: String) -> Binding<String> {
        Binding(get: { draft.otherValues[id, default: ""] }, set: { draft.otherValues[id] = $0 })
    }
}
