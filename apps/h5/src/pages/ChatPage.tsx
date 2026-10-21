import { useNavigate } from "react-router-dom";
import { useFanto } from "../fanto/FantoContext";
import { FantoAvatar } from "../fanto/FantoAvatar";
import { ArrowUp, MessageCircleMore, RotateCcw, Sparkles, Square } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
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
import { fantoLabel } from "../fanto/settings-state";

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
  const navigate = useNavigate();
  const profile = useFanto();
  const { settings: fantoSettings, sessionId, refresh: refreshRoles } = profile;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [historyCursor, setHistoryCursor] = useState<number | null>(null);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const loadingEarlierRef = useRef(false);
  const [draft, setDraft] = useState(() => {
    try { return sessionId ? sessionStorage.getItem(`fanto.chat-draft.${sessionId}`) ?? "" : ""; } catch { return ""; }
  });
  useEffect(() => {
    try { if (sessionId) sessionStorage.setItem(`fanto.chat-draft.${sessionId}`, draft); } catch { /* Draft remains in memory. */ }
  }, [draft, sessionId]);
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

  const loadEarlierHistory = async () => {
    const element = scrollRef.current;
    if (!element || element.scrollTop > 96 || !sessionId || !hasMoreHistory ||
      historyCursor === null || loadingEarlierRef.current || loading || recovering || responding) return;
    loadingEarlierRef.current = true;
    setLoadingEarlier(true);
    const revision = conversationRevision.current;
    const oldHeight = element.scrollHeight;
    const oldTop = element.scrollTop;
    try {
      const page = await fetchAgentSnapshot(sessionId, historyCursor);
      if (revision !== conversationRevision.current) return;
      setMessages(current => {
        const known = new Set(current.map(message => message.id));
        const older: ChatMessage[] = page.messages.filter(message => !known.has(message.id))
          .map(message => ({ ...message, state: message.state ?? "complete" }));
        return [...older, ...current];
      });
      setHasMoreHistory(page.hasMore);
      setHistoryCursor(page.nextCursor);
      requestAnimationFrame(() => {
        const latest = scrollRef.current;
        if (latest) latest.scrollTop = oldTop + latest.scrollHeight - oldHeight;
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加载更早对话失败");
    } finally {
      loadingEarlierRef.current = false;
      setLoadingEarlier(false);
    }
  };

  const load = useCallback(async () => {
    if (!sessionId) { setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const snapshot = await fetchAgentSnapshot(sessionId);
      if (snapshot.restored) setRecoveryNotice("已恢复保存的历史，部分最近消息可能未保存。");
      setRecovering(snapshot.running);
      setMessages(snapshot.messages.map(message => ({ ...message, state: message.state ?? "complete" })));
      setHasMoreHistory(snapshot.hasMore); setHistoryCursor(snapshot.nextCursor);
    } catch (cause) {
      setError("暂时无法读取这个对话，请重试或切换角色。");
      if (cause instanceof ApiError && (cause.status === 403 || cause.status === 404)) void refreshRoles();
    } finally { setLoading(false); scrollToEnd(); }
  }, [sessionId, refreshRoles, scrollToEnd]);

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
          setHasMoreHistory(snapshot.hasMore);
          setHistoryCursor(snapshot.nextCursor);
          setStopping(false);
          stoppingRef.current = false;
          setError(null);
          return;
        }
      } catch (cause) {
        if (cancelled) return;
        if (cause instanceof ApiError && (cause.status === 403 || cause.status === 404)) {
          setRecovering(false); setStopping(false); setError("这个对话已不可用，请切换角色。"); void refreshRoles(); return;
        }
        setError("正在恢复对话，请检查网络连接。");
      }
      if (!cancelled) timer = setTimeout(() => void refresh(), 1500);
    };
    void refresh();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [recovering, sessionId, refreshRoles]);

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

  const sendMessage = async (wireText: string, visibleText: string, clarificationInteractionId?: string) => {
    if (!wireText.trim() || !sessionId || loading || responding || stopping || recovering) return;
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
      } else if (cause instanceof ApiError && (cause.status === 403 || cause.status === 404 || cause.code === "INVALID_STATE")) {
        updateAssistant(message => ({ ...message, state: "failed" }));
        setError("这个角色已不可用，请切换对话。"); setDraft(current => current || visibleText); void refreshRoles();
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
    if (!text || !sessionId || loading || responding || stopping || recovering) return;
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
        <button type="button" className="chat-title fanto-chat-title" onClick={() => navigate(fantoSettings ? `/fantos/${fantoSettings.fantoId}` : "/fantos")} aria-label="打开当前角色配置">
          <FantoAvatar size={40} avatarMediaId={fantoSettings?.avatarMediaId ?? null} label={fantoLabel(fantoSettings)}/>
          <div><strong>{fantoLabel(fantoSettings)}</strong><span>{fantoSettings?.description || (fantoSettings ? "独立对话与记忆" : "基于你的记录继续聊")}</span></div>
        </button>
        <div className="fanto-chat-controls">
          <label className="sr-only" htmlFor="chat-role">切换对话角色</label>
          <select id="chat-role" value={profile.selectedId ?? ""} disabled={!profile.selectedId || profile.loading} onChange={event => profile.select(event.target.value)}>
            {profile.roles.filter(role => role.status === "active").map(role => <option key={role.fantoId} value={role.fantoId}>{fantoLabel(role)}</option>)}
          </select>
          <button className="secondary-button" onClick={() => navigate("/fantos")}>管理角色</button>
        </div>
      </header>

      <div className="chat-debug"><DebugId label="sessionId" value={sessionId} /></div>
      <div className="chat-scroll" ref={scrollRef} onScroll={() => void loadEarlierHistory()}>
        <div className="chat-content">
          {loadingEarlier && <div className="chat-history-loading">正在加载更早对话…</div>}
          {loading || profile.loading && !sessionId ? (
            <div className="empty-state chat-loading"><span className="large-loader" /><p>正在恢复对话…</p></div>
          ) : (error || profile.error) && messages.length === 0 ? (
            <div className="empty-state">
              <div className="empty-orb"><RotateCcw size={22} /></div>
              <h2>暂时没有连接上 Fanto</h2><p>{error || profile.error}</p>
              <button className="secondary-button" onClick={() => void (sessionId ? load() : refreshRoles())}><RotateCcw size={16} />重新连接</button>
            </div>
          ) : messages.length === 0 ? (
            <div className="chat-welcome">
              <div className="welcome-mark"><MessageCircleMore size={28} /></div>
              <p className="eyebrow">Fanto</p>
              <h1>{fantoSettings ? `与${fantoLabel(fantoSettings)}开始对话。` : "从现在想说的事情开始。"}</h1>
              <p>{fantoSettings?.nickname === "fanto" ? "这是你的默认 Fanto，拥有独立的对话与长期记忆。" : "这段对话与记忆属于当前角色，其他角色无法读取。"}</p>
              <div className="prompt-suggestions">
                <button onClick={() => setDraft(fantoSettings && !fantoSettings.agentConfig.recordReadEnabled ? "今天想和你聊聊。" : "最近我都记录了什么？")}>{fantoSettings && !fantoSettings.agentConfig.recordReadEnabled ? "今天想和你聊聊。" : "最近我都记录了什么？"}</button>
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
            placeholder={`和${fantoLabel(fantoSettings)}聊聊`}
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
