import { Check, CircleHelp, Send } from "lucide-react";
import { useMemo, useState } from "react";
import type { PresentedUserInputRequest, UserInputQuestion } from "../api/agent";

type AnswerValue = string | string[];
const OTHER = "__fanto_other__";

function answerReady(question: UserInputQuestion, value: AnswerValue | undefined, other: string | undefined): boolean {
  if (question.type === "text") return typeof value === "string" && Boolean(value.trim());
  if (question.type === "single_select") return typeof value === "string" && (value !== OTHER || Boolean(other?.trim()));
  return Array.isArray(value) && value.length > 0 && (!value.includes(OTHER) || Boolean(other?.trim()));
}

function answerText(question: UserInputQuestion, value: AnswerValue, other: string | undefined): string {
  if (question.type === "text") return String(value).trim();
  const labels = new Map(question.options.map(option => [option.value, option.label]));
  const values = Array.isArray(value) ? value : [value];
  return values.map(item => item === OTHER ? other?.trim() ?? "其他" : labels.get(item) ?? item).join("、");
}

export function UserInputCard({
  request,
  disabled,
  onSubmit,
}: {
  request: PresentedUserInputRequest;
  disabled?: boolean;
  onSubmit: (visibleText: string) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [others, setOthers] = useState<Record<string, string>>({});
  const ready = useMemo(
    () => request.questions.every(question => answerReady(question, answers[question.id], others[question.id])),
    [answers, others, request.questions],
  );

  if (request.resolved) {
    return (
      <div className="user-input-card resolved">
        <span className="user-input-resolved-icon"><Check size={15} /></span>
        <div><strong>{request.title}</strong><span>已回答</span></div>
      </div>
    );
  }

  const submit = () => {
    const text = request.questions.map(question => `${question.label}：${answerText(question, answers[question.id]!, others[question.id])}`).join("\n");
    onSubmit(text);
  };

  return (
    <form className="user-input-card" onSubmit={event => { event.preventDefault(); if (ready && !disabled) submit(); }}>
      <div className="user-input-heading">
        <span className="user-input-kicker"><CircleHelp size={14} />需要你的确认</span>
        <strong>{request.title}</strong>
        {request.description && <p>{request.description}</p>}
      </div>
      <div className="user-input-questions">
        {request.questions.map(question => (
          <fieldset className="user-input-question" key={question.id}>
            <legend>{question.label}</legend>
            {question.type === "text" ? (
              question.multiline ? (
                <textarea
                  rows={3}
                  value={typeof answers[question.id] === "string" ? answers[question.id] as string : ""}
                  placeholder={question.placeholder}
                  disabled={disabled}
                  onChange={event => setAnswers(current => ({ ...current, [question.id]: event.target.value }))}
                />
              ) : (
                <input
                  value={typeof answers[question.id] === "string" ? answers[question.id] as string : ""}
                  placeholder={question.placeholder}
                  disabled={disabled}
                  onChange={event => setAnswers(current => ({ ...current, [question.id]: event.target.value }))}
                />
              )
            ) : (
              <>
                <div className="user-input-options">
                  {question.options.map(option => {
                    const value = answers[question.id];
                    const selected = question.type === "single_select" ? value === option.value : Array.isArray(value) && value.includes(option.value);
                    return (
                      <button
                        type="button"
                        className={selected ? "selected" : ""}
                        aria-pressed={selected}
                        disabled={disabled}
                        key={option.value}
                        onClick={() => {
                          if (question.type === "single_select") {
                            setAnswers(current => ({ ...current, [question.id]: option.value }));
                          } else {
                            const currentValue = Array.isArray(answers[question.id]) ? answers[question.id] as string[] : [];
                            const next = currentValue.includes(option.value)
                              ? currentValue.filter(item => item !== option.value)
                              : [...currentValue, option.value];
                            setAnswers(current => ({ ...current, [question.id]: next }));
                          }
                        }}
                      >{option.label}</button>
                    );
                  })}
                  {question.allowOther && (
                    <button
                      type="button"
                      className={(question.type === "single_select" ? answers[question.id] === OTHER : Array.isArray(answers[question.id]) && (answers[question.id] as string[]).includes(OTHER)) ? "selected" : ""}
                      aria-pressed={question.type === "single_select" ? answers[question.id] === OTHER : Array.isArray(answers[question.id]) && (answers[question.id] as string[]).includes(OTHER)}
                      disabled={disabled}
                      onClick={() => {
                        if (question.type === "single_select") setAnswers(current => ({ ...current, [question.id]: OTHER }));
                        else {
                          const currentValue = Array.isArray(answers[question.id]) ? answers[question.id] as string[] : [];
                          const next = currentValue.includes(OTHER) ? currentValue.filter(item => item !== OTHER) : [...currentValue, OTHER];
                          setAnswers(current => ({ ...current, [question.id]: next }));
                        }
                      }}
                    >其他</button>
                  )}
                </div>
                {question.allowOther && (question.type === "single_select" ? answers[question.id] === OTHER : Array.isArray(answers[question.id]) && (answers[question.id] as string[]).includes(OTHER)) && (
                  <input
                    className="user-input-other"
                    value={others[question.id] ?? ""}
                    placeholder="补充你的想法"
                    disabled={disabled}
                    onChange={event => setOthers(current => ({ ...current, [question.id]: event.target.value }))}
                  />
                )}
              </>
            )}
          </fieldset>
        ))}
      </div>
      <div className="user-input-footer">
        <span>提交后将继续当前对话</span>
        <button type="submit" className="user-input-submit" disabled={!ready || disabled}>
          <Send size={15} />提交回答
        </button>
      </div>
    </form>
  );
}
