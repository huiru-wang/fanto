import { Check, MessageCircleQuestion } from "lucide-react";

type ClarificationItem = { question?: string; answer: string };

function splitClarification(content: string): ClarificationItem[] {
  return content.split("\n").map(line => line.trim()).filter(Boolean).map(line => {
    const separator = line.search(/[：:]/);
    if (separator < 1) return { answer: line };
    return {
      question: line.slice(0, separator).trim(),
      answer: line.slice(separator + 1).trim(),
    };
  });
}

export function UserClarificationCard({ content }: { content: string }) {
  const items = splitClarification(content);

  return (
    <section className="user-clarification-card" aria-label="已提交的澄清回答">
      <header className="user-clarification-heading">
        <span className="user-clarification-icon"><MessageCircleQuestion size={16} /></span>
        <span className="user-clarification-title"><small>你的澄清</small><strong>已补充的信息</strong></span>
        <span className="user-clarification-status"><Check size={13} />已提交</span>
      </header>
      <div className="user-clarification-answers">
        {items.map((item, index) => (
          <div className="user-clarification-answer" key={`${item.question ?? "answer"}-${index}`}>
            {item.question && <span>{item.question}</span>}
            <p>{item.answer}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
