import assert from "node:assert/strict";
import test from "node:test";
import { createRunContext } from "../run-context.js";
import { CreatorContextProvider } from "./creator-context.js";
import { ProposalContextProvider } from "./proposal-context.js";

const sampleContext = (fields:Record<string,unknown>) => createRunContext({
  runId:"run",userId:"owner",sessionId:"session",query:"query",slots:{},recentMessages:[],...fields,
});

test("Creator provider separates Goal, Project and linked Records while limiting previews", async () => {
  const records = Array.from({length:2}, (_,i)=>({
    id:"r"+i,eventAt:"2026-10-08T09:00:00Z",
    content:{text:"R".repeat(4000),blocks:[{type:"image",mediaId:"image-"+i,description:"D".repeat(1400)}]},
  }));
  let calls=0;
  const provider = new CreatorContextProvider({creativeContext:async()=>{
    calls++;
    return {goal:{objective:"一组角色写真"},project:{projectId:"p",title:"图集",summary:"",status:"queued",version:2,content:"C".repeat(20000)},
      records:{data:records,hasMore:true,nextCursor:"cursor"}};
  }} as never);
  const result = await provider.build(sampleContext({projectId:"p"}));
  assert.equal(calls,1);
  assert.deepEqual(Object.keys(result),["creator_goal","creator_project","creator_records"]);
  assert.match(result.creator_goal,/一组角色写真/);
  assert.match(result.creator_project,/已截断/);
  assert.match(result.creator_records,/image-0/);
  assert.match(result.creator_records,/已截断/);
  assert.match(result.creator_records,/"hasMore": true/);
  assert.ok(!result.creator_records.includes("R".repeat(3000)));
});

test("Proposal provider separates trigger and candidates and rejects malformed data", async () => {
  const provider = new ProposalContextProvider({creativeContext:async()=>({
    sourceRecord:{recordId:"r",version:1,content:{text:"旅行",blocks:[]}},
    candidateProjects:{search:"semantic_lexical_recent",candidates:[{projectId:"p",title:"旧作品"}]},
  })} as never);
  const result=await provider.build(sampleContext({recordId:"r",recordVersion:1}));
  assert.match(result.proposal_record,/旅行/);
  assert.match(result.proposal_projects,/旧作品/);
  assert.ok(!result.proposal_record.includes("旧作品"));
  assert.ok(!result.proposal_projects.includes("旅行"));
});
