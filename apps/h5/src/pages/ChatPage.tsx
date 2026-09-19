import { ArrowUp, MessageCircleMore, Plus, RotateCcw, Sparkles, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createAgentSession,
  fetchAgentHistory,
  streamAgentMessage,
  type AgentHistoryMessage,
} from "../api/agent";
import { ApiError } from "../api/http";
import { AGENT_SESSION_KEY } from "../config";

type MessageState = "complete" | "processing" | "streaming" | "stopped" | "failed";
type ChatMessage = AgentHistoryMessage & { state: MessageState };

const localId = () => `local-${crypto.randomUUID()}`;

export function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [responding, setResponding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }));
  }, []);

  const createFreshSession = useCallback(async () => {
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
          const history = await fetchAgentHistory(stored);
          setSessionId(stored);
          setMessages(history.map(message => ({ ...message, state: "complete" })));
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

  useEffect(() => () => abortRef.current?.abort(), []);

  const newConversation = async () => {
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

  const send = async () => {
    const text = draft.trim();
    if (!text || !sessionId || responding) return;

    const userMessage: ChatMessage = { id: localId(), role: "user", text, state: "complete" };
    const assistantId = localId();
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: "assistant",
      text: "",
      state: "processing",
    };

    setDraft("");
    setError(null);
    setMessages(current => [...current, userMessage, assistantMessage]);
    setResponding(true);
    scrollToEnd();

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamAgentMessage(
        sessionId,
        text,
        event => {
          if (event.type === "processing") {
            setMessages(current => current.map(message =>
              message.id === assistantId && !message.text
                ? { ...message, state: "processing" }
                : message,
            ));
          } else if (event.type === "delta") {
            setMessages(current => current.map(message =>
              message.id === assistantId
                ? { ...message, text: message.text + event.text, state: "streaming" }
                : message,
            ));
            scrollToEnd();
          } else if (event.type === "done") {
            setMessages(current => current.map(message =>
              message.id === assistantId ? { ...message, state: "complete" } : message,
            ));
          } else if (event.type === "error") {
            setMessages(current => current.map(message =>
              message.id === assistantId ? { ...message, state: "failed" } : message,
            ));
            setError(event.message);
          }
        },
        controller.signal,
      );
    } catch (cause) {
      if (controller.signal.aborted) {
        setMessages(current => current.map(message =>
          message.id === assistantId ? { ...message, state: "stopped" } : message,
        ));
      } else {
        setMessages(current => current.map(message =>
          message.id === assistantId ? { ...message, state: "failed" } : message,
        ));
        setError(cause instanceof Error ? cause.message : "这次回复没有完成");
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setResponding(false);
      scrollToEnd();
    }
  };

  const stop = () => {
    abortRef.current?.abort();
  };

  return (
    <div className="chat-page">
      <header className="chat-header">
        <div className="chat-title">
          <span className="chat-avatar"><Sparkles size={17} /></span>
          <div>
            <strong>Fanto</strong>
            <span>基于你的记录继续聊</span>
          </div>
        </div>
        <button className="secondary-button compact" onClick={() => void newConversation()} disabled={loading}>
          <Plus size={16} />
          <span>新对话</span>
        </button>
      </header>

      <div className="chat-scroll">
        <div className="chat-content">
          {loading ? (
            <div className="empty-state chat-loading">
              <span className="large-loader" />
              <p>正在恢复对话…</p>
            </div>
          ) : error && messages.length === 0 ? (
            <div className="empty-state">
              <div className="empty-orb"><RotateCcw size={22} /></div>
              <h2>暂时没有连接上 Fanto</h2>
              <p>{error}</p>
              <button className="secondary-button" onClick={() => void load()}>
                <RotateCcw size={16} />重新连接
              </button>
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
                <article className={`message ${message.role}`} key={message.id}>
                  {message.role === "assistant" && (
                    <span className="message-avatar"><Sparkles size={14} /></span>
                  )}
                  <div className="message-body">
                    {message.text ? (
                      <p>{message.text}</p>
                    ) : (
                      <div className="thinking-row">
                        <span className="thinking-dots"><i /><i /><i /></span>
                        <span>正在回想…</span>
                      </div>
                    )}
                    {message.state === "stopped" && <span className="message-state">已停止生成</span>}
                    {message.state === "failed" && <span className="message-state error">回复未完成</span>}
                  </div>
                </article>
              ))}
              {error && <div className="chat-inline-error">{error}</div>}
            </div>
          )}
          <div ref={endRef} />
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
            disabled={!responding && (!draft.trim() || !sessionId || loading)}
            onClick={responding ? stop : () => void send()}
            aria-label={responding ? "停止生成" : "发送消息"}
          >
            {responding ? <Square size={15} fill="currentColor" /> : <ArrowUp size={19} />}
          </button>
        </div>
        <span className="chat-disclaimer">测试环境 · Fanto 可能会出错，请以原始记录为准</span>
      </div>
    </div>
  );
}
