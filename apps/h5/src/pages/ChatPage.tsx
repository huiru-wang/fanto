import { useNavigate } from "react-router-dom";
import { getFanto, restartFanto } from "../api/fanto";
import { useFanto } from "../fanto/FantoContext";
import { FantoAvatar } from "../fanto/FantoAvatar";
import { ArrowUp, SquarePen, RotateCcw, Sparkles, Square } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  encodeUserInputResponse,
  streamAgentMessage,
  stopAgentSession,
  fetchAgentSnapshot,
  type AgentHistoryMessage,
  type AgentMessageBlock,
  type PresentedUserInputRequest,
} from "../api/agent";
import { ApiError } from "../api/http";
import { LiquidGlassFilters, LiquidGlassLayer } from "../components/LiquidGlass";
import { NarrativeComposer } from "../components/NarrativeComposer";
import { parseDraft, restoreDraft, serializeDraft } from "../components/narrative-draft";
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
    return <div className="message-text-block"><ChatMarkdown text={block.content} /></div>;
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
  const activeRoles = profile.roles.filter(role => role.status === "active")
    .sort((a, b) => Number(b.fantoId === profile.selectedId) - Number(a.fantoId === profile.selectedId));
  const extraRoleCount = Math.max(0, activeRoles.length - 2);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [historyCursor, setHistoryCursor] = useState<number | null>(null);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const loadingEarlierRef = useRef(false);
  const [draftParts, setDraftParts] = useState(() => {
    try { return restoreDraft(sessionId ? sessionStorage.getItem(`fanto.chat-draft.${sessionId}`) ?? "" : ""); }
    catch { return parseDraft(""); }
  });
  const draft = serializeDraft(draftParts);
  const setDraft = (value: string | ((current: string) => string)) => setDraftParts(current => {
    const text = serializeDraft(current);
    const next = typeof value === "function" ? value(text) : value;
    return next === text ? current : parseDraft(next);
  });
  useEffect(() => {
    try { if (sessionId) sessionStorage.setItem(`fanto.chat-draft.${sessionId}`, JSON.stringify({ version: 1, parts: draftParts })); }
    catch { /* Draft remains in memory. */ }
  }, [draftParts, sessionId]);
  const [showRestart, setShowRestart] = useState(false);
  const restartDialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (showRestart) restartDialogRef.current?.showModal();
    else restartDialogRef.current?.close();
  }, [showRestart]);
  const [restarting, setRestarting] = useState(false);
  const restartInFlight = useRef(false);
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
  const pageRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const composer = composerRef.current;
    const page = pageRef.current;
    if (!composer || !page) return;
    const observer = new ResizeObserver(() => {
      const scroll = scrollRef.current;
      const nearEnd = scroll && scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 120;
      page.style.setProperty("--composer-height", `${composer.getBoundingClientRect().height}px`);
      if (nearEnd && scroll) scroll.scrollTop = scroll.scrollHeight;
    });
    observer.observe(composer);
    return () => observer.disconnect();
  }, []);
  const previousScrollTop = useRef(0);
  const touchStartY = useRef<number | null>(null);

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
    if (!element || element.scrollTop > 16 || !sessionId || !hasMoreHistory ||
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
    if (!wireText.trim() || !sessionId || loading || responding || stopping || recovering || restartInFlight.current) return;
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
    if (!text || !sessionId || loading || responding || stopping || recovering || restartInFlight.current) return;
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
      const snapshot=await fetchAgentSnapshot(sessionId);
      if (conversationRevision.current===revision && !abortRef.current) {
        setMessages(snapshot.messages.map(message=>({...message,state:message.state ?? "complete"})));
        setHasMoreHistory(snapshot.hasMore);
        setHistoryCursor(snapshot.nextCursor);
      }
    } catch { /* Keep the visible partial reply; history can be retried on refresh. */ }
  };

  const restart = async () => {
    if (!fantoSettings || restartInFlight.current || responding || recovering || stopping || loading) return;
    restartInFlight.current = true; setRestarting(true); setError(null);
    try {
      const value = await restartFanto(fantoSettings.fantoId, fantoSettings.version);
      try { sessionStorage.removeItem(`fanto.chat-draft.${sessionId}`); } catch { /* The old Session will never be reused. */ }
      profile.accept(value);
    } catch (cause) {
      // Never repeat a destructive POST after an unknown result.
      try {
        const current = await getFanto(fantoSettings.fantoId);
        profile.accept(current);
        if (current.sessionId !== sessionId) {
          try { sessionStorage.removeItem(`fanto.chat-draft.${sessionId}`); } catch { /* Best effort local draft cleanup. */ }
          return;
        }
      } catch { /* Keep current conversation visible until status can be checked. */ }
      setError(cause instanceof ApiError && cause.code === "FANTO_BUSY" ? "角色正在回复，请在回复结束后重新开始。"
        : cause instanceof ApiError && cause.code === "VERSION_CONFLICT" ? "角色状态已更新，请核对后重新操作。"
        : "暂时无法确认是否已重新开始，请刷新页面核对后再操作。");
    } finally { restartInFlight.current = false; setRestarting(false); }
  };

  return (
    <div className="chat-page" ref={pageRef}>
      <LiquidGlassFilters />
      <header className="chat-header">
        <button type="button" className="chat-title fanto-chat-title glass-capsule liquid-glass-surface" onClick={() => navigate(fantoSettings ? `/fantos/${fantoSettings.fantoId}` : "/fantos")} aria-label="查看当前角色详情" disabled={restarting}>
          <LiquidGlassLayer />
          <FantoAvatar size={36} avatarMediaId={fantoSettings?.avatarMediaId ?? null} label={fantoLabel(fantoSettings)} />
          <strong>{fantoLabel(fantoSettings)}</strong>
        </button>
        <div className="chat-header-actions">
          <button className="role-avatar-navigation" disabled={restarting}
            aria-label={`选择角色，共 ${activeRoles.length} 个角色`} title="选择角色" onClick={() => navigate("/fantos")}>
            <span className="role-avatar-stack" aria-hidden="true">
              {activeRoles.length ? activeRoles.slice(0, 2).map(role => <FantoAvatar key={role.fantoId} size={44}
                avatarMediaId={role.avatarMediaId} label={fantoLabel(role)} />) : <FantoAvatar size={44} avatarMediaId={null} />}
            </span>
            {extraRoleCount > 0 && <span className="role-avatar-count" aria-hidden="true">+{extraRoleCount}</span>}
          </button>
          <button className="glass-capsule liquid-glass-surface icon-capsule" disabled={restarting || loading || !sessionId || responding || stopping || recovering}
            aria-label="重新开始对话" title="重新开始对话" aria-busy={restarting} onClick={() => setShowRestart(true)}><LiquidGlassLayer /><SquarePen size={20} strokeWidth={1.8} /></button>
        </div>
      </header>

      <dialog ref={restartDialogRef} className="restart-dialog" aria-labelledby="restart-title" aria-describedby="restart-description"
        onCancel={() => setShowRestart(false)}>
        <h2 id="restart-title">重新开始对话？</h2>
        <p id="restart-description">将永久清除与「{fantoLabel(fantoSettings)}」的聊天记录和该角色的长期记忆，角色设定保持不变。此操作无法撤销。</p>
        <div className="restart-dialog-actions">
          <button className="secondary-button" autoFocus onClick={() => setShowRestart(false)}>取消</button>
          <button className="danger-button" onClick={() => { setShowRestart(false); void restart(); }}>清除并重新开始</button>
        </div>
      </dialog>

      <div className="chat-scroll" ref={scrollRef}
        onScroll={event => {
          const top = event.currentTarget.scrollTop;
          const upward = top < previousScrollTop.current;
          previousScrollTop.current = top;
          if (upward && top <= 16) void loadEarlierHistory();
        }}
        onWheel={event => { if (event.deltaY < 0) void loadEarlierHistory(); }}
        onTouchStart={event => { touchStartY.current = event.touches[0]?.clientY ?? null; }}
        onTouchMove={event => {
          const y = event.touches[0]?.clientY;
          if (y !== undefined && touchStartY.current !== null && y > touchStartY.current) void loadEarlierHistory();
          touchStartY.current = y ?? null;
        }}
        onTouchEnd={() => { touchStartY.current = null; }}>
        <div className="chat-content">
          {loadingEarlier && <div className="chat-history-loading" role="status" aria-label="正在加载更早对话"><span className="large-loader" aria-hidden="true" /></div>}
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
              <FantoAvatar size={72} avatarMediaId={fantoSettings?.avatarMediaId ?? null} label={fantoLabel(fantoSettings)} />
              <h1>{fantoLabel(fantoSettings)}</h1>
              <p>想说什么，都可以从这里开始。</p>
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

      <div className="chat-composer-wrap" ref={composerRef}>
        <NarrativeComposer parts={draftParts} onChange={setDraftParts} disabled={loading || restarting || !sessionId}
            placeholder={`和${fantoLabel(fantoSettings)}聊聊`} onSend={() => { if (!responding) void send(); }}>
          <button
            className={`chat-send ${responding ? "stop" : ""}`}
            disabled={restarting || recovering || stopping || (!responding && (!draft.trim() || !sessionId || loading))}
            onClick={responding ? () => void stop() : () => void send()}
            aria-label={stopping ? "正在停止" : responding ? "停止生成" : "发送消息"}
          >
            {responding ? <Square size={15} fill="currentColor" /> : <ArrowUp size={19} />}
          </button>
        </NarrativeComposer>
        {(stopping || recovering || recoveryNotice) && <span role="status" className="chat-disclaimer">{stopping ? "正在结束当前操作，你可以先输入下一条消息…" : recovering ? "正在恢复对话，完成后可继续发送…" : recoveryNotice}</span>}
      </div>
    </div>
  );
}
