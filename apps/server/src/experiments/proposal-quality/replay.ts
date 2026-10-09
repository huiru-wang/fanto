/** Isolated live-model probe. No user DB writes; the tools return synthetic fixture data only. */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { proposalAgentPrompt } from "../../agent/prompts/proposal-agent.js";
import { createProposalSchema } from "../../domain/projects/validation.js";

const here=dirname(fileURLToPath(import.meta.url));
const serverRoot=resolve(here,"../../../");
const cases=JSON.parse(readFileSync(resolve(here,"cases.json"),"utf8")) as Array<{
  id:string;domain:string;triggerRecord:string;existingProject:null|{alias:string;summary:string};
  expected:{decision:string;changeKind?:string;targetProjectAlias?:string};
}>;
const envFile=resolve(serverRoot,".env");
const env=Object.fromEntries(readFileSync(envFile,"utf8").split(/\r?\n/).filter(s=>s.includes("=")&&!s.trim().startsWith("#"))
  .map(s=>{const i=s.indexOf("=");return[s.slice(0,i).trim(),s.slice(i+1).trim().replace(/^['\"]|['\"]$/g,"")];}));
const apiKey=process.env.DEEPSEEK_API_KEY??env.DEEPSEEK_API_KEY;
if(!apiKey)throw Error("DEEPSEEK_API_KEY is required for live replay");
const model=process.env.PROPOSAL_EVAL_MODEL??"deepseek-v4-flash";
const limit=Number(process.argv[2]??"8");
const start=Number(process.argv[3]??"0");
const stride=Math.max(1,Number(process.argv[4]??"1"));
const projectId="33333333-3333-4333-8333-333333333333";
const recordId="22222222-2222-4222-8222-222222222222";
const allowedSkills=new Set(["project-evolution","creative-opportunity"]);
const skillRoot=resolve(serverRoot,"skills");
const tools = [
 {type:"function",function:{name:"project_read",description:"按 Project ID 读取完整内容、目标和关联记录；或搜索相关项目",parameters:{type:"object",properties:{action:{type:"string",enum:["search","get"]},projectId:{type:"string"},query:{type:"string"}},required:["action"]}}},
 {type:"function",function:{name:"record_read",description:"读取真实 Record，包括历史检索",parameters:{type:"object",properties:{recordIds:{type:"array",items:{type:"string"}},query:{type:"string"}}}}},
 {type:"function",function:{name:"skill_read",description:"读取当前 Agent 允许的 Skill 文本",parameters:{type:"object",properties:{skill:{type:"string"},path:{type:"string"}},required:["skill","path"]}}},
 {type:"function",function:{name:"proposal_create",description:"保存唯一 Proposal。create 用 content.ideas，每个 idea 有 goal；extend 用 content.change，没有新 goal。",parameters:{type:"object",properties:{type:{type:"string",enum:["create","extend"]},title:{type:"string"},targetProjectId:{type:"string"},proposedSummary:{type:"string"},recordIds:{type:"array",items:{type:"string"}},content:{type:"object"}},required:["type","title","recordIds","content"]}}},
];
const outputs:Array<{id:string;decision:string;changeKind?:string;targetProjectAlias?:string;error?:string}>=[];
for(const c of cases.filter((_case,i)=>i>=start && (i-start)%stride===0).slice(0,limit)){
 const candidate=c.existingProject?{projectId,title:"既有项目",summary:c.existingProject.summary,goal:{objective:c.existingProject.summary},contentExcerpt:c.existingProject.summary,source:"semantic",status:"completed",version:2}:null;
 const context={role:"proposal",sourceRecord:{recordId,version:1,eventAt:"2026-10-09T00:00:00+08:00",content:{text:c.triggerRecord,blocks:[]}},
  candidateProjects:{search:"semantic_lexical_recent",candidates:candidate?[candidate]:[]}};
 const index=`\n<available_skills>\n<skill><name>project-evolution</name><description>Project 增量判断</description><location>skills/project-evolution/SKILL.md</location></skill>\n<skill><name>creative-opportunity</name><description>新创意机会判断</description><location>skills/creative-opportunity/SKILL.md</location></skill>\n</available_skills>\nUse skill_read with skill=one of these names and path=SKILL.md to read the full skill. Use references/foo.md for subtopics.`;
 const system=proposalAgentPrompt.replace("{{creative_context}}",JSON.stringify(context))+index;
 const messages:any[]=[{role:"system",content:system},{role:"user",content:"完整理解这条 Record，先核查已有 Project 延续价值，再判断是否有新提议。不要追问。"}];
 let answer:any=null;
 try{
  for(let turn=0;turn<9;turn++){
   const response=await fetch("https://api.deepseek.com/chat/completions",{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},
    body:JSON.stringify({model,messages,tools,temperature:0.25,max_tokens:2800})});
   if(!response.ok)throw Error(`API ${response.status}: ${(await response.text()).slice(0,160)}`);
   const result=await response.json() as {choices?:Array<{message:any}>};
   const message=result.choices?.[0]?.message;
   if(!message)throw Error("empty response");
   messages.push(message);
   const calls=message.tool_calls as Array<{id:string;function:{name:string;arguments:string}}> | undefined;
   if(!calls?.length){
    try{const v=JSON.parse(String(message.content).trim());if(v.decision==="no_proposal")answer={id:c.id,decision:"no_proposal"};}catch{}
    if(!answer)throw Error("no structured decision");
    break;
   }
   for(const call of calls){
    const args=JSON.parse(call.function.arguments);
    let data:unknown;
    if(call.function.name==="skill_read"){
      if(!allowedSkills.has(args.skill)||typeof args.path!=="string"||!(/^(SKILL\.md|references\/[a-z-]+\.md)$/).test(args.path))throw Error(`invalid skill path: ${String(args.skill)} / ${String(args.path)}`);
      data=readFileSync(resolve(skillRoot,args.skill,args.path),"utf8");
    } else if(call.function.name==="record_read"){
      data={records:[{recordId,content:{text:c.triggerRecord,blocks:[]}}]};
    } else if(call.function.name==="project_read"){
      data=args.action==="search"?{data:candidate?[candidate]:[]}:(candidate&&(!args.projectId||args.projectId===projectId)?{...candidate,referenceRecords:[],recordCount:0}:{error:"NOT_FOUND"});
    } else if(call.function.name==="proposal_create"){
      const parsed=createProposalSchema.safeParse(args);
      if(!parsed.success){data={error:"INVALID_INPUT",issues:parsed.error.issues.slice(0,5)};}
      else {
        const value=parsed.data;
        answer={id:c.id,decision:value.type,...(value.type==="extend"?{changeKind:value.content.change.kind,targetProjectAlias:value.targetProjectId===projectId?"project-A":"wrong-project"}:{})};
        data={proposalId:"44444444-4444-4444-8444-444444444444",status:"pending"};
      }
    } else {data={error:"UNSUPPORTED_TOOL"};}
    messages.push({role:"tool",tool_call_id:call.id,content:typeof data==="string"?data:JSON.stringify(data)});
   }
   if(answer)break;
  }
  outputs.push(answer??{id:c.id,decision:"incomplete"});
 }catch(error){outputs.push({id:c.id,decision:"error",error:String(error).slice(0,200)});}
 console.log(`${c.id} ${c.domain}: expected=${c.expected.decision}, got=${outputs.at(-1)?.decision}`);
}
const outputPath=resolve(here,"replay-output.json");
writeFileSync(outputPath,JSON.stringify(outputs,null,2));
console.log(`Synthetic replay output saved to ${outputPath}`);
