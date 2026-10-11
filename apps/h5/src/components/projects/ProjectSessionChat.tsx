import { ArrowUp, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchAgentHistory, streamAgentMessage, watchSessionEvents, type AgentHistoryMessage, type AgentMessageBlock, type AgentStreamEvent } from "../../api/agent";
import type { ProjectStatus } from "../../api/projects";
import { ChatMessageItem, type ChatMessage } from "../../pages/ChatPage";

type Props = { sessionId: string; projectId: string; status: ProjectStatus; onUpdated: () => void };
const newId = () => crypto.randomUUID();
const hideInternalIds = (text: string) => text.replace(/(?:mediaId|projectId|sessionId)\s*(?:是|为|[:=])\s*`?[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}`?/gi, "素材已确认");
const displayedBlocks = (blocks: AgentMessageBlock[]) => blocks.map(block => block.type === "text" ? { ...block, content: hideInternalIds(block.content) } : block);
export function ProjectSessionChat({ sessionId, projectId, status, onUpdated }: Props) {
  const [messages, setMessages] = useState<AgentHistoryMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [liveBlocks, setLiveBlocks] = useState<AgentMessageBlock[]>([]);
  const [error, setError] = useState("");
  const sendingRef = useRef(false);
  const view = useRef<HTMLDivElement>(null);
  const updated = useRef(onUpdated);
  updated.current = onUpdated;
  const refresh = useCallback(async () => {
    try { setMessages(await fetchAgentHistory(sessionId)); }
    catch (e) { setError(e instanceof Error ? e.message : "无法读取会话历史"); }
  }, [sessionId]);
  const apply = useCallback((event: AgentStreamEvent) => {
    if (event.type === "delta") setLiveBlocks(current => {
      const blocks = [...current], last = blocks[blocks.length - 1];
      if (last?.type === "text") blocks[blocks.length - 1] = { type: "text", content: last.content + event.text };
      else blocks.push({ type: "text", content: event.text });
      return blocks;
    });
    if (event.type === "tool_start" && event.presentation.visible)
      setLiveBlocks(current => [...current, { type: "activity", toolCallId: event.toolCallId, status: "running", presentation: event.presentation }]);
    if (event.type === "tool_end") setLiveBlocks(current => {
      const blocks = [...current];
      const i = blocks.findIndex(b => b.type === "activity" && b.toolCallId === event.toolCallId);
      if (!event.presentation.visible) { if (i >= 0) blocks.splice(i, 1); }
      else if (i >= 0) blocks[i] = { type: "activity", toolCallId: event.toolCallId, status: event.status, presentation: event.presentation };
      else blocks.push({ type: "activity", toolCallId: event.toolCallId, status: event.status, presentation: event.presentation });
      return blocks;
    });
    if (event.type === "media") setLiveBlocks(current => [...current, { type: "media", items: event.items }]);
    if (event.type === "error") setError(event.message);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { view.current?.scrollTo({ top: view.current.scrollHeight, behavior: "smooth" }); }, [messages, liveBlocks]);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      while (!controller.signal.aborted) {
        try {
          await watchSessionEvents(sessionId, controller.signal, event => {
            if (sendingRef.current) return; // POST stream owns its own live events
            apply(event);
            if (event.type === "done" || event.type === "stopped" || event.type === "error") {
              setLiveBlocks([]);
              void refresh().then(() => updated.current());
            }
          });
        } catch (e) {
          // An optional read-only subscription must not block sending a message.
          if (controller.signal.aborted) break;
          if (e instanceof Error && !/订阅暂时不可用/.test(e.message)) setError(e.message);
        }
        if (!controller.signal.aborted) {
          await new Promise<void>(resolve => {
            const timer = setTimeout(resolve, 2000);
            controller.signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
          });
          if (!controller.signal.aborted) void refresh();
        }
      }
    })();
    return () => controller.abort();
  }, [sessionId, refresh, apply]);
  const submit = async () => {
    const message = draft.trim();
    if (!message || sendingRef.current || (status !== "completed" && status !== "failed")) return;
    sendingRef.current = true;
    setSending(true);
    setError("");
    setLiveBlocks([]);
    setDraft("");
    setMessages(current => [...current, { id: newId(), role: "user", blocks: [{ type: "text", content: message }] }]);
    try {
      await streamAgentMessage(sessionId, message, apply, undefined, { projectId });
    } catch (e) {
      setError(e instanceof Error ? e.message : "创作未完成，请检查历史后再试");
    } finally {
      sendingRef.current = false;
      setSending(false);
      setLiveBlocks([]);
      await refresh();
      updated.current();
    }
  };
  return <section className="project-session-chat" aria-label="创作对话">
    <div className="project-session-messages" ref={view}>
      {messages.length === 0 && liveBlocks.length === 0 && <p className="project-muted">创作过程会在这里出现。</p>}
      {messages.map(message => <ChatMessageItem key={message.id} message={{ ...message, blocks: message.role === "assistant" ? displayedBlocks(message.blocks) : message.blocks, state: message.state ?? "complete" } as ChatMessage} responding={sending} onSubmitInput={() => {}} />)}
      {liveBlocks.length > 0 && <ChatMessageItem message={{ id: "live", role: "assistant", blocks: displayedBlocks(liveBlocks), state: "streaming" }} responding={sending} onSubmitInput={() => {}} />}
      {sending && liveBlocks.length === 0 && <p className="project-muted">正在回应…</p>}
      {error && <p className="project-form-error" role="alert">{error}</p>}
    </div>
    {status !== "archived" && <div className="project-session-composer">
      <textarea rows={2} placeholder={status === "queued" ? "等待创作开始…" : status === "running" ? "Fanto 正在创作…" : "继续聊聊，或者告诉 Fanto 想怎么修改…"}
        value={draft} disabled={status === "queued" || status === "running" || sending}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(); } }} />
      <button type="button" disabled={sending || (status !== "completed" && status !== "failed") || !draft.trim()} onClick={() => void submit()} aria-label="发送">
        {sending ? <LoaderCircle size={19} /> : <ArrowUp size={19} />}
      </button>
    </div>}
  </section>;
}
