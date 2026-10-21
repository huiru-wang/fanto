import {fantoMemoryGuidance} from "../../prompts/fanto-core.js";
import type {Context} from "@earendil-works/pi-agent-core";
import type {AgentBusinessServices,AgentMemory} from "../../business-services.js";
import {createRunContext} from "../run-context.js";
import type {FantoSettings} from "../../../domain/fanto/index.js";
/** Retain whole entries, never slice the first-person memory text. */
export function boundedFantoMemory(items:AgentMemory[]){
 const selected:AgentMemory[]=[];
 for(const item of items){if(Buffer.byteLength(JSON.stringify([...selected,item]),"utf8")>12000)break;selected.push(item);}
 return JSON.stringify(selected);
}
const section=(title:string,content:string)=>content.trim()?("\n## "+title+"\n"+content.trim()):"";
export function mainDynamicText(f:FantoSettings):string{
 let text="你以当前角色的第一人称视角和用户对话，区分虚构与现实。空身份字段不代表固定性格，也不需要补充占位符。";
 text+=section("角色名称",f.nickname);
 text+=section("身份与性格",f.roleConfig.character);
 text+=section("世界与关系",f.roleConfig.scenario);
 text+=section("交流方式",f.roleConfig.instructions);
 text+=section("示例（并非已发生的记忆）",f.roleConfig.exampleDialogues);
 if(f.agentConfig.narrationEnabled)text+=section("动作与旁白格式","角色动作、环境与旁白可使用 Markdown 引用块（>）；说话用普通段落，不要每句话都加动作。");
 else text+=section("表达方式","不生成角色动作、小说旁白或环境舞台描写；普通 Markdown 引用文本仍可以正常使用。");
 if(f.agentConfig.fantoMemoryEnabled)text+=section("角色独立记忆指导",fantoMemoryGuidance);
 if(f.agentConfig.recordReadEnabled)text+=section("记录","可按需使用 record_read 查询用户现实世界记录；不要假装角色在自己的世界天然知道这些信息。");
 return text;
}
export class MainDynamicProvider {
 readonly slot="dynamic_main";
 readonly required=true;
 constructor(private readonly services:AgentBusinessServices){}
 async build(context:Context){
  const run=createRunContext.read(context);
  const f=run.mainConfig;
  if(!f)throw new Error("FANTO_REQUIRED");
  const c={userId:run.userId,sessionId:run.sessionId,signal:context.abortSignal,traceId:run.traceId};
  let text=mainDynamicText(f);
  if(f.agentConfig.fantoMemoryEnabled){
   const items=await this.services.listMemories(c);
   text+=section("当前角色的长期记忆",boundedFantoMemory(items));
  }
  return {slot:this.slot,content:text};
 }
}
