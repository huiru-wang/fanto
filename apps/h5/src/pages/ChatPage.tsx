import { useNavigate } from "react-router-dom";
import { useFanto } from "../fanto/FantoContext";
import { FantoAvatar } from "../fanto/FantoAvatar";
import { ArrowUp, MessageCircleMore, Plus, RotateCcw, Sparkles, Square } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  createAgentSession,
  encodeUserInputResponse,
  fetchAgentHistory,
  streamAgentMessage,
  stopAgentSession,
  fetchAgentSnapshot,
  type AgentHistoryMessage,
  type AgentMessageBlock,
  type PresentedUserInputRequest,
} from "../api/agent";
import { DebugId } from "../components/DebugId";
import { ApiError } from "../api/http";
import { ChatMarkdown } from "../components/ChatMarkdown";
import { MediaPresentation } from "../components/MediaPresentation";
import { UserClarificationCard } from "../components/UserClarificationCard";
import { UserInputCard } from "../components/UserInputCard";
import { AGENT_SESSION_KEY } from "../config";

type MessageState = "complete" | "processing" | "streaming" | "stopped" | "failed";
export type ChatMessage = Omit<AgentHistoryMessage, "state"> & { state: MessageState };

const localId = () => `local-${crypto.randomUUID()}`;

export const ChatMessageItem = memo(function ChatMessageItem({
  message,
  personalized = false,
  responding,
  onSubmitInput,
}: {
  message: ChatMessage;
  personalized?: boolean;
  responding: boolean;
  onSubmitInput: (request: PresentedUserInputRequest, visibleText: string) => void;
}) {
  const hasContent = message.blocks.length > 0;
  const isClarification = message.role === "user" && message.blocks.some(block => block.type === "user_input_response");

  return (
    <article className={`message ${message.role}${isClarification ? " clarification" : ""}`}>
      {message.role === "assistant" && <span className="message-avatar">{personalized ? <FantoAvatar size={28}/> : <Sparkles size={14} />}</span>}
      <div className="message-body">
        {hasContent ? (
          <div className="message-block-list">
            {message.blocks.map((block, index) => (
              <MessageBlock
                block={block}
                role={message.role}
                responding={responding}
                onSubmitInput={onSubmitInput}
                key={block.type === "activity" ? `activity-${block.toolCallId}` : `${block.type}-${index}`}
              />
            ))}
          </div>
        ) : message.state === "processing" || message.state === "streaming" ? (
          <div className="thinking-row">
            <span className="thinking-dots"><i /><i /><i /></span>
            <span>正在想…</span>
          </div>
        ) : null}
        {message.state === "stopped" && <span className="message-state">已停止生成</span>}
        {message.state === "failed" && <span className="message-state error">回复未完成</span>}
      </div>
    </article>
  );
});

function MessageBlock({
  block,
  role,
  responding,
  onSubmitInput,
}: {
  block: AgentMessageBlock;
  role: "user" | "assistant";
  responding: boolean;
  onSubmitInput: (request: PresentedUserInputRequest, visibleText: string) => void;
}) {
  if (block.type === "text") {
    return role === "assistant"
      ? <div className="message-text-block"><ChatMarkdown text={block.content} /></div>
      : <p className="message-text-block">{block.content}</p>;
  }
  if (block.type === "user_input_response") return <UserClarificationCard content={block.content} />;
  if (block.type === "activity") {
    return (
      <div className={`tool-activity-row ${block.presentation.animation ? "is-running" : ""}`}>
        {block.presentation.animation && <span className="thinking-dots"><i /><i /><i /></span>}
        <span>{block.presentation.displayContent}</span>
      </div>
    );
  }
  if (block.type === "media") return <MediaPresentation items={block.items} />;
  return (
    <div className="chat-input-request-list">
      <UserInputCard
        request={block.request}
        disabled={responding}
        onSubmit={visibleText => onSubmitInput(block.request, visibleText)}
      />
    </div>
  );
}

export function ChatPage({ active = true }: { active?: boolean }) {
  const navigate=useNavigate(); const {settings:fantoSettings}=useFanto();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [stopping, setStopping] = useState(false);
  const [responding, setResponding] = useState(false);
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stoppingRef = useRef(false);
  const conversationRevision = useRef(0);
  const [recovering, setRecovering] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const isNearEnd = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return true;
    return element.scrollHeight - element.scrollTop - element.clientHeight < 120;
  }, []);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => {
      const element = scrollRef.current;
      if (element) element.scrollTop = element.scrollHeight;
    });
  }, []);

  const createFreshSession = useCallback(async () => {
    conversationRevision.current += 1;
    const id = await createAgentSession();
    localStorage.setItem(AGENT_SESSION_KEY, id);
    setSessionId(id);
    setMessages([]);
    return id;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const stored = localStorage.getItem(AGENT_SESSION_KEY);
      if (!stored) {
        await createFreshSession();
      } else {
        try {
          const snapshot = await fetchAgentSnapshot(stored);
          const history = snapshot.messages;
          if (snapshot.restored) setRecoveryNotice("已恢复保存的历史，部分最近消息可能未保存。");
          setRecovering(snapshot.running);
          setSessionId(stored);
          setMessages(history.map(message => ({ ...message, state: message.state ?? "complete" })));
        } catch (cause) {
          if (cause instanceof ApiError && (cause.status === 403 || cause.status === 404)) {
            localStorage.removeItem(AGENT_SESSION_KEY);
            await createFreshSession();
          } else {
            throw cause;
          }
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "暂时无法连接 Fanto");
    } finally {
      setLoading(false);
      scrollToEnd();
    }
  }, [createFreshSession, scrollToEnd]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (active) scrollToEnd(); }, [active, scrollToEnd]);
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!recovering || !sessionId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const snapshot = await fetchAgentSnapshot(sessionId);
        if (cancelled) return;
        // This effect only runs after the original stream is detached; use the live server snapshot.
        if (snapshot.running) {
          setMessages(snapshot.messages.map(message => ({ ...message, state: message.state ?? "processing" })));
          setStopping(snapshot.stopping === true);
        }
        if (!snapshot.running) {
          setMessages(snapshot.messages.map(message => ({ ...message, state: message.state ?? "complete" })));
          setRecovering(false);
          setStopping(false);
          stoppingRef.current = false;
          setError(null);
          return;
        }
      } catch { if (!cancelled) setError("正在恢复对话，请检查网络连接。"); }
      if (!cancelled) timer = setTimeout(() => void refresh(), 1500);
    };
    void refresh();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [recovering, sessionId]);

  useEffect(() => {
    const reconcile = () => {
      if (document.visibilityState === "visible" && !abortRef.current && !loading && sessionId) setRecovering(true);
    };
    window.addEventListener("focus", reconcile);
    document.addEventListener("visibilitychange", reconcile);
    return () => {
      window.removeEventListener("focus", reconcile);
      document.removeEventListener("visibilitychange", reconcile);
    };
  }, [loading, sessionId]);

  const newConversation = async () => {
    if (stopping || recovering) return;
    if (responding) abortRef.current?.abort();
    setResponding(false);
    setLoading(true);
    setError(null);
    try {
      await createFreshSession();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "没有创建成功");
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = async (wireText: string, visibleText: string, clarificationInteractionId?: string) => {
    if (!wireText.trim() || !sessionId || responding || stopping || recovering) return;
    const userMessage: ChatMessage = {
      id: localId(),
      role: "user",
      blocks: [clarificationInteractionId
        ? { type: "user_input_response", interactionId: clarificationInteractionId, content: visibleText }
        : { type: "text", content: visibleText }],
      state: "complete",
    };
    const assistantId = localId();
    const assistantMessage: ChatMessage = {
      id: assistantId, role: "assistant", blocks: [], state: "processing",
    };

    setError(null);
    setMessages(current => [...current, userMessage, assistantMessage]);
    setRecoveryNotice(null);
    setResponding(true);
    scrollToEnd();

    conversationRevision.current += 1;
    const controller = new AbortController();
    abortRef.current = controller;
    let textBlockOpen = false;

    const updateAssistant = (update: (message: ChatMessage) => ChatMessage) => {
      setMessages(current => current.map(message => message.id === assistantId ? update(message) : message));
    };

    const appendBlock = (block: AgentMessageBlock) => {
      updateAssistant(message => ({ ...message, blocks: [...message.blocks, block], state: "streaming" }));
    };

    try {
      await streamAgentMessage(
        sessionId,
        wireText,
        event => {
          if (abortRef.current !== controller) return;
          if (stoppingRef.current && !["tool_end", "stopped", "done", "error"].includes(event.type)) return;
          if (event.type === "finalizing") {
            // Informational only; history persistence never locks the composer.
          } else if (event.type === "processing") {
            updateAssistant(message => message.state === "processing" ? message : { ...message, state: "processing" });
          } else if (event.type === "message_start") {
            textBlockOpen = false;
          } else if (event.type === "message_end") {
            textBlockOpen = false;
          } else if (event.type === "delta") {
            const follow = isNearEnd();
            const startsNewBlock = !textBlockOpen;
            textBlockOpen = true;
            updateAssistant(message => {
              if (startsNewBlock) {
                return { ...message, blocks: [...message.blocks, { type: "text", content: event.text }], state: "streaming" };
              }
              const blocks = [...message.blocks];
              let index = blocks.length - 1;
              while (index >= 0 && blocks[index]?.type !== "text") index -= 1;
              const current = index >= 0 ? blocks[index] : undefined;
              if (current?.type === "text") blocks[index] = { ...current, content: current.content + event.text };
              else blocks.push({ type: "text", content: event.text });
              return { ...message, blocks, state: "streaming" };
            });
            if (follow) scrollToEnd();
          } else if (event.type === "tool_start") {
            textBlockOpen = false;
            if (event.presentation.visible) {
              appendBlock({ type: "activity", toolCallId: event.toolCallId, status: "running", presentation: event.presentation });
              scrollToEnd();
            }
          } else if (event.type === "tool_end") {
            textBlockOpen = false;
            updateAssistant(message => {
              const blocks = [...message.blocks];
              const index = blocks.findIndex(block => block.type === "activity" && block.toolCallId === event.toolCallId);
              if (!event.presentation.visible) {
                if (index >= 0) blocks.splice(index, 1);
              } else if (index >= 0) {
                blocks[index] = { type: "activity", toolCallId: event.toolCallId, status: event.status, presentation: event.presentation };
              } else {
                blocks.push({ type: "activity", toolCallId: event.toolCallId, status: event.status, presentation: event.presentation });
              }
              return { ...message, blocks, state: "streaming" };
            });
            scrollToEnd();
          } else if (event.type === "media") {
            appendBlock({ type: "media", items: event.items });
            scrollToEnd();
          } else if (event.type === "user_input") {
            appendBlock({ type: "user_input", request: event.request });
            scrollToEnd();
          } else if (event.type === "stopped") {
            updateAssistant(message => ({...message,state:"stopped"}));
          } else if (event.type === "done") {
            const follow = isNearEnd();
            updateAssistant(message => ({ ...message, state: "complete" }));
            if (follow) scrollToEnd();
          } else if (event.type === "error") {
            updateAssistant(message => ({ ...message, state: "failed" }));
            setError(event.message);
          }
        },
        controller.signal,
      );
    } catch (cause) {
      if (abortRef.current !== controller) return;
      if (controller.signal.aborted) {
        updateAssistant(message => ({ ...message, state: "stopped" }));
      } else {
        setRecovering(true);
        updateAssistant(message => ({ ...message, state: "failed" }));
        setError(cause instanceof ApiError && cause.status === 409 ? "会话仍在处理中，正在恢复对话。" : "连接已中断，正在核对回复状态。");
        if (cause instanceof ApiError && cause.status === 409) setDraft(current => current || visibleText);
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setResponding(false);
        stoppingRef.current = false;
        setStopping(false);
          }
      if (isNearEnd()) scrollToEnd();
    }
  };

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    await sendMessage(text, text);
  };

  const submitUserInput = (request: PresentedUserInputRequest, visibleText: string) => {
    if (responding || stopping) return;
    setMessages(current => current.map(message => ({
      ...message,
      blocks: message.blocks.map(block => block.type === "user_input" && block.request.interactionId === request.interactionId
        ? { ...block, request: { ...block.request, resolved: true } }
        : block),
    })));
    void sendMessage(encodeUserInputResponse(request.interactionId, visibleText), visibleText, request.interactionId);
  };

  const stop = async () => {
    if (!sessionId || stopping || recovering) return;
    stoppingRef.current=true;
    setStopping(true);
    const controller=abortRef.current;
    const revision=conversationRevision.current;
    const assistantId=messages.at(-1)?.id;
    let waitingForTool = false;
    try {
      const result = await stopAgentSession(sessionId);
      if (abortRef.current !== controller) return;
      if (result.stopping) { waitingForTool = true; return; }
      controller?.abort();
      if (abortRef.current === controller || abortRef.current === null) {
        abortRef.current=null;
        setResponding(false);
        setMessages(current=>current.map(message=>message.id===assistantId ? {...message,state:"stopped"} : message));
      }
    } catch(cause) {
      setError(`停止未确认，请重试。${cause instanceof Error ? cause.message : ""}`);
      return;
    } finally { if (!waitingForTool) { stoppingRef.current=false;setStopping(false); } }
    // History is supplementary; sending resumes when the in-memory turn has finished.
    try {
      const history=await fetchAgentHistory(sessionId);
      if (conversationRevision.current===revision && !abortRef.current)
        setMessages(history.map(message=>({...message,state:message.state ?? "complete"})));
    } catch { /* Keep the visible partial reply; history can be retried on refresh. */ }
  };

  return (
    <div className="chat-page">
      <header className="chat-header">
        <button type="button" className="chat-title fanto-chat-title" onClick={()=>navigate("/fanto/settings")} aria-label="打开 Fanto 设置">
          <FantoAvatar size={40}/>
          <div><strong>{fantoSettings?.nickname ?? "Fanto"}</strong><span>{fantoSettings?.description || "基于你的记录继续聊"}</span></div>
        </button>
        <button className="secondary-button compact" onClick={() => void newConversation()} disabled={loading || stopping || recovering}>
          <Plus size={16} /><span>新对话</span>
        </button>
      </header>

      <div className="chat-debug"><DebugId label="sessionId" value={sessionId} /></div>

      <div className="chat-scroll" ref={scrollRef}>
        <div className="chat-content">
          {loading ? (
            <div className="empty-state chat-loading"><span className="large-loader" /><p>正在恢复对话…</p></div>
          ) : error && messages.length === 0 ? (
            <div className="empty-state">
              <div className="empty-orb"><RotateCcw size={22} /></div>
              <h2>暂时没有连接上 Fanto</h2><p>{error}</p>
              <button className="secondary-button" onClick={() => void load()}><RotateCcw size={16} />重新连接</button>
            </div>
          ) : messages.length === 0 ? (
            <div className="chat-welcome">
              <div className="welcome-mark"><MessageCircleMore size={28} /></div>
              <p className="eyebrow">Fanto</p>
              <h1>从现在想说的事情开始。</h1>
              <p>我会在需要的时候回想你的记录，但不会把工具和检索过程打扰到对话里。</p>
              <div className="prompt-suggestions">
                <button onClick={() => setDraft("最近我都记录了什么？")}>最近我都记录了什么？</button>
                <button onClick={() => setDraft("帮我回顾一下最近反复在想的事情。")}>最近反复在想什么？</button>
              </div>
            </div>
          ) : (
            <div className="message-list">
              {messages.map(message => (
                <ChatMessageItem
                  personalized
                  message={message}
                  responding={responding}
                  onSubmitInput={submitUserInput}
                  key={message.id}
                />
              ))}
              {error && <div className="chat-inline-error">{error}</div>}
            </div>
          )}
        </div>
      </div>

      <div className="chat-composer-wrap">
        <div className="chat-composer">
          <textarea
            value={draft}
            onChange={event => setDraft(event.target.value)}
            rows={1}
            placeholder="和 Fanto 聊聊"
            disabled={loading || !sessionId}
            onKeyDown={event => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <button
            className={`chat-send ${responding ? "stop" : ""}`}
            disabled={recovering || stopping || (!responding && (!draft.trim() || !sessionId || loading))}
            onClick={responding ? () => void stop() : () => void send()}
            aria-label={stopping ? "正在停止" : responding ? "停止生成" : "发送消息"}
          >
            {responding ? <Square size={15} fill="currentColor" /> : <ArrowUp size={19} />}
          </button>
        </div>
        <span className="chat-disclaimer">{stopping ? "正在结束当前操作，你可以先输入下一条消息…" : recovering ? "正在恢复对话，完成后可继续发送…" : recoveryNotice ?? "测试环境 · Fanto 可能会出错，请以原始记录为准"}</span>
      </div>
    </div>
  );
}
