import { useLayoutEffect, useRef, type ReactNode } from "react";
import { TextQuote } from "lucide-react";
import { finishNarration, insertNarration, type DraftPart } from "./narrative-draft";

// §2.1: message text is primary; mode is a small secondary control.
// §3.6: group description text with its inset surface; use existing 8/12/16 tokens.
export function NarrativeComposer({ parts, onChange, disabled, placeholder, onSend, children }: {
  parts: DraftPart[]; onChange: (parts: DraftPart[]) => void; disabled: boolean; placeholder: string; onSend: () => void; children?: ReactNode;
}) {
  const fields = useRef(new Map<string, HTMLTextAreaElement>());
  const active = useRef<string | null>(null);
  const pendingFocus = useRef<{ id: string; atEnd?: boolean } | null>(null);
  useLayoutEffect(() => {
    for (const field of fields.current.values()) {
      field.style.height = "auto";
      field.style.height = `${field.scrollHeight}px`;
    }
    const target = pendingFocus.current ?? (active.current && !fields.current.has(active.current) && parts[0] ? { id: parts[0].id } : null);
    if (target) {
      pendingFocus.current = null;
      const field = fields.current.get(target.id);
      if (field) {
        field.focus();
        const position = target.atEnd ? field.value.length : 0;
        field.setSelectionRange(position, position);
      }
    }
  }, [parts]);
  const finish = (part: DraftPart, field: HTMLTextAreaElement) => {
    const result = finishNarration(parts, part.id, field.selectionStart, field.selectionEnd);
    pendingFocus.current = { id: result.focusId }; onChange(result.parts);
  };
  const add = () => {
    const part = parts.find(item => item.id === active.current) ?? parts.at(-1)!;
    const field = fields.current.get(part.id);
    if (part.kind === "narration" && field) { field.focus(); return; }
    const result = insertNarration(parts, part.id, field?.selectionStart ?? part.text.length, field?.selectionEnd ?? part.text.length);
    pendingFocus.current = { id: result.focusId }; onChange(result.parts);
  };
  return <div className="narrative-composer-container">
    <div className="narrative-toolbar">
      <button type="button" className="narrative-mode" disabled={disabled} onClick={add}><TextQuote size={16} />动作与旁白</button>
    </div>
    <div className="chat-composer">
    <div className="narrative-editor">
    <div className="narrative-fields">
      {parts.map(part => <div key={part.id} className={`narrative-part ${part.kind}`}>
        <textarea ref={field => { if (field) fields.current.set(part.id, field); else fields.current.delete(part.id); }}
          value={part.text} rows={1} disabled={disabled}
          aria-label={part.kind === "narration" ? "动作与旁白" : "语言"}
          placeholder={part.kind === "narration" ? "描述动作、神态或周围的场景…" : placeholder}
          onFocus={() => { active.current = part.id; }}
          onChange={event => {
            const text = event.target.value;
            const input = event.nativeEvent as InputEvent;
            // Some virtual keyboards only emit input, without keydown/beforeinput.
            if (part.kind === "narration" && input.inputType === "insertLineBreak" && !input.isComposing) {
              const caret = event.target.selectionStart;
              const updated = parts.map(item => item.id === part.id ? { ...item, text } : item);
              const result = finishNarration(updated, part.id, Math.max(0, caret - 1), caret);
              pendingFocus.current = { id: result.focusId }; onChange(result.parts);
            } else onChange(parts.map(item => item.id === part.id ? { ...item, text } : item));
          }}
          onBeforeInput={event => {
            const input = event.nativeEvent as InputEvent;
            if (part.kind === "narration" && input.inputType === "insertLineBreak" && !input.isComposing) {
              event.preventDefault(); finish(part, event.currentTarget);
            }
          }}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === "Enter" && part.kind === "narration") { event.preventDefault(); finish(part, event.currentTarget); }
            else if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); onSend(); }
            else if (event.key === "Backspace" && !part.text && parts.length > 1) {
              event.preventDefault();
              const index = parts.findIndex(item => item.id === part.id);
              const previous = parts[index - 1];
              const next = parts[index + 1];
              pendingFocus.current = previous ? { id: previous.id, atEnd: true } : next ? { id: next.id } : null;
              onChange(parts.filter(item => item.id !== part.id));
            }
          }} />
      </div>)}
    </div>
    </div>
    {children}
    </div>
  </div>;
}
