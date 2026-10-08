import { ArrowUp, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { streamAgentMessage, watchProjectEvents, type AgentHistoryMessage } from "../../api/agent";
import { fetchProjectHistory } from "../../api/projects";
import { ChatMessageItem, type ChatMessage } from "../../pages/ChatPage";

type Props = {projectId:string;sessionId:string;onUpdated:()=>void};
export function ProjectSessionChat({projectId,sessionId,onUpdated}:Props) {
  const [messages,setMessages]=useState<AgentHistoryMessage[]>([]);
  const [draft,setDraft]=useState("");
  const [sending,setSending]=useState(false);
  const [streamed,setStreamed]=useState("");
  const [activity,setActivity]=useState("");
  const [error,setError]=useState("");
  const view=useRef<HTMLDivElement>(null);
  const sendingRef=useRef(false);
  const onUpdatedRef=useRef(onUpdated);
  onUpdatedRef.current=onUpdated;
  const refresh=useCallback(async()=> {
    try { const page=await fetchProjectHistory(projectId);setMessages(page.messages);setError(""); }
    catch(e){setError(e instanceof Error?e.message:"无法读取对话");}
  },[projectId]);
  useEffect(()=> {void refresh();const timer=setInterval(()=>void refresh(),3000);return()=>clearInterval(timer);},[refresh]);
  useEffect(()=> {view.current?.scrollTo({top:view.current.scrollHeight,behavior:"smooth"});},[messages,streamed,activity]);
  useEffect(()=>{
    const controller=new AbortController();
    void watchProjectEvents(projectId,controller.signal,event=>{
      if (event.type==="tool_start" && event.presentation.visible && !sendingRef.current) setActivity(event.presentation.displayContent);
      if (event.type==="tool_end" && event.presentation.visible && !sendingRef.current) setActivity(event.presentation.displayContent);
      if (event.type==="delta" && !sendingRef.current) setStreamed(text=>text+event.text);
      if (event.type==="done" || event.type==="error") {
        void refresh().then(()=>onUpdatedRef.current());
        if (!sendingRef.current) {setStreamed("");setActivity("");}
      }
    }).catch(()=>{});
    return ()=>controller.abort();
  },[projectId,refresh]);

  const submit=async()=>{
    const message=draft.trim(); if(!message||sending)return;
    setDraft("");setError("");setSending(true);sendingRef.current=true;setStreamed("");setActivity("正在回应…");
    try {
      await streamAgentMessage(sessionId,message,event=>{
        if(event.type==="delta")setStreamed(v=>v+event.text);
        if(event.type==="tool_start" && event.presentation.visible)setActivity(event.presentation.displayContent);
        if(event.type==="tool_end")setActivity(event.presentation.displayContent);
      },undefined,projectId);
      await refresh();onUpdated();
    }catch(e){setError(e instanceof Error?e.message:"发送失败");}
    finally{setSending(false);sendingRef.current=false;setStreamed("");setActivity("");}
  };
  return <section className="project-session-chat" aria-label="脉络创作对话">
    <div className="project-session-messages" ref={view}>
      {messages.length===0 && <p className="project-muted">创作过程会在这里出现，可以随时继续交流。</p>}
      {messages.map(message=><ChatMessageItem key={message.id} message={{...message,state:"complete"} as ChatMessage} responding={sending}
        onSubmitInput={()=>{}} />)}
      {(sending||streamed) && <div className="project-session-live">{activity && <span>{activity}</span>}{streamed && <p>{streamed}</p>}</div>}
      {error && <p className="project-form-error" role="alert">{error}</p>}
    </div>
    <div className="project-session-composer">
      <textarea rows={2} placeholder="继续聊聊，或者告诉 Fanto 想怎么修改…" value={draft}
        disabled={sending} onChange={e=>setDraft(e.target.value)}
        onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void submit();}}}/>
      <button type="button" disabled={sending||!draft.trim()} onClick={()=>void submit()} aria-label="发送">
        {sending?<LoaderCircle size={19}/>:<ArrowUp size={19}/>}
      </button>
    </div>
  </section>;
}
