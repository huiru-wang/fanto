import { ArrowUp, MessageCircleMore, Plus, RotateCcw, Sparkles, Square } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  createAgentSession,
  encodeUserInputResponse,
  fetchAgentHistory,
  streamAgentMessage,
  stopAgentSession,
  type AgentHistoryMessage,
  type AgentMessageBlock,
  type PresentedUserInputRequest,
} from "../api/agent";
import { ApiError } from "../api/http";
import { ChatMarkdown } from "../components/ChatMarkdown";
import { MediaPresentation } from "../components/MediaPresentation";
import { TaskCard } from "../components/TaskCard";
import { UserClarificationCard } from "../components/UserClarificationCard";
import { UserInputCard } from "../components/UserInputCard";
import { AGENT_SESSION_KEY } from "../config";

type MessageState = "complete" | "processing" | "streaming" | "stopped" | "failed";
export type ChatMessage = Omit<AgentHistoryMessage, "state"> & { state: MessageState };

const localId = () => `local-${crypto.randomUUID()}`;

export const ChatMessageItem = memo(function ChatMessageItem({
  message,
  responding,
  onSubmitInput,
}: {
  message: ChatMessage;
  responding: boolean;
  onSubmitInput: (request: PresentedUserInputRequest, visibleText: string) => void;
}) {
  const hasContent = message.blocks.length > 0;
  const isClarification = message.role === "user" && message.blocks.some(block => block.type === "user_input_response");

  return (
    <article className={`message ${message.role}${isClarification ? " clarification" : ""}`}>
      {message.role === "assistant" && <span className="message-avatar"><Sparkles size={14} /></span>}
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
  if (block.type === "task") return <div className="chat-task-list"><TaskCard task={block.task} /></div>;
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

export function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [stopping, setStopping] = useState(false);
  const [responding, setResponding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
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
  useEffect(() => () => abortRef.current?.abort(), []);

  const newConversation = async () => {
    if (stopping) return;
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
    if (!wireText.trim() || !sessionId || responding || stopping) return;
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
    setResponding(true);
    scrollToEnd();

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
          if (event.type === "processing") {
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
          } else if (event.type === "task") {
            appendBlock({ type: "task", task: event.task });
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
      if (controller.signal.aborted) {
        updateAssistant(message => ({ ...message, state: "stopped" }));
      } else {
        updateAssistant(message => ({ ...message, state: "failed" }));
        setError(cause instanceof Error ? cause.message : "这次回复没有完成");
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setResponding(false);
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
    if (!sessionId || stopping) return;
    setStopping(true);
    const controller=abortRef.current;
    try {
      await stopAgentSession(sessionId);
      controller?.abort();
      const history=await fetchAgentHistory(sessionId);
      setMessages(history.map(message=>({...message,state:message.state ?? "complete"})));
    } catch(cause) {setError(cause instanceof Error ? cause.message : "停止未确认，请重试");}
    finally {setStopping(false);}
  };

  return (
    <div className="chat-page">
      <header className="chat-header">
        <div className="chat-title">
          <span className="chat-avatar"><Sparkles size={17} /></span>
          <div><strong>Fanto</strong><span>基于你的记录继续聊</span></div>
        </div>
        <button className="secondary-button compact" onClick={() => void newConversation()} disabled={loading || stopping}>
          <Plus size={16} /><span>新对话</span>
        </button>
      </header>

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
            disabled={loading || stopping || !sessionId}
            onKeyDown={event => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <button
            className={`chat-send ${responding ? "stop" : ""}`}
            disabled={stopping || (!responding && (!draft.trim() || !sessionId || loading))}
            onClick={responding ? () => void stop() : () => void send()}
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
