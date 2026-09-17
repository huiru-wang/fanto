import { randomUUID } from "node:crypto";
import { loadConfig, loadEnv } from "../bootstrap/config.js";
import { createDatabase } from "../infrastructure/database/database.js";

loadEnv();
const db = createDatabase(loadConfig().sqlitePath);
const userId = "creation-demo-user";
const now = "2026-09-14T09:00:00.000Z";
const notes = [
  "晨会前把方案的问题写成三句，客户第一次没有追问我们在解决什么。", "下午砍掉两页解释，反而让设计和业务开始讨论同一个取舍。", "连续会议后去楼下绕一圈，回来才发现刚才漏掉了一个关键假设。", "今天没有急着给答案，先问每个人最担心什么，会议比往常安静也更有效。", "给明天留了一张空白便签，只写最重要的一件沟通。", "拒绝了一个临时需求后，团队终于有时间把原来的交付做完整。", "复盘里把失败写成选择链路，而不是归因给某个人。", "下班前合上电脑，没有再开新标签页，心里第一次有了收尾感。", "把模糊反馈画成关系图，发现真正冲突的是目标而不是方案。", "客户说这次终于听懂了，提醒我讲清楚比讲很多更难。",
  "整理过去项目时，最想留下的不是成果页，而是把混乱重新组织起来的过程。", "和主管聊发展，我说希望参与方向判断，而不仅是把需求做漂亮。", "看见朋友换工作后，开始区分我想靠近的能力和我想逃开的压力。", "有人说我擅长让不同的人说出真实顾虑，这比一个职位名称更像线索。", "写下五年后的问题时没有答案，但明确不想只做被分配的执行。", "今天发现职业选择也许不是跳跃，而是一次次靠近愿意承担的问题。", "把简历里的动词圈出来，发现自己最有能量时总在连接人和复杂信息。", "听一位产品负责人分享后，想练习把判断讲得更可被质疑。", "不再把晋升当唯一标尺，开始问自己是否拥有更多选择。", "晚上记下：想成为能让团队看清方向的人。",
  "在西湖边画云时，线条比照片更接近那天缓慢下来的感觉。", "给旧速写本挑出三页，不扫描全部，只留下今天仍然想看的画。", "把泉州的招牌、宁波的海和杭州的云放在一页小样里，色彩竟然能互相说话。", "看摄影集时喜欢它不急着解释，想让自己的页面也留一点空白。", "午后用十分钟画办公室窗外，发现不需要完成才算创作。", "朋友看到小样后说像一段散步，我想继续保留这种不确定的叙述。", "学了一点版式，第一次把照片和手写文字放在同一个呼吸里。", "翻到旧画时没有觉得过时，反而想知道当时的自己在停留什么。", "今天只修了一张照片，但它让我想起旅行里没有安排的下午。", "把速写夹进随身本，提醒自己灵感不是待办。",
  "到泉州后没有列景点，只跟着巷子里的香味走到一间小庙。", "开元寺附近坐了半小时，听雨停下来比拍照更像旅行。", "莫干山雨后的山路没有终点感，脚步自然慢下来。", "在宁波看潮水退回去，下午什么也不做竟然很充实。", "旅行回来最怀念的是早晨还不知道要去哪里的那段时间。", "想再去泉州，不是补景点，而是重走那条有卖花阿姨的小路。", "准备下次旅行时只记三件想做的事，其余交给当天的身体。", "在火车上画窗外的电线杆，比刷攻略更能让我进入陌生城市。", "发现最好的纪念品不是买来的，是回家后仍愿意翻开的几张照片。", "周末徒步只带水和本子，路上写下风穿过树叶的声音。",
  "今天回看记录，发现散步、收尾和画画都在帮我把时间还给自己。", "一个没有安排的傍晚，让我重新听见自己其实想做什么。", "不是所有念头都要立刻变成计划，有些先留下就已经足够。", "当我把问题写清楚，焦虑会从身体里退一点。", "最近反复出现的不是效率，而是希望做事时仍保有选择。", "把旅行的停留和工作的空白放在一起看，它们都在提醒我慢一点。", "今天没有完成更多，却比平时更知道自己下一步要拒绝什么。", "记录里开始出现同一种光线，也许我在寻找一个可以停下来的位置。", "我想练习把还没想明白的事说出来，而不是急着给自己结论。", "留半小时回看这些片段，像给不断变化的自己留一个入口。"
] as const;
const kinds = [["kind-thread", "thread", "持续线索"], ["kind-project", "project", "正在推进"], ["kind-collection", "collection", "收藏与素材"]] as const;
const creations = [
  ["把一天重新交还给自己", "kind-thread", "你正在从工作结束后的微小选择里，找回自己的节奏。", "## 现在看到的关联\n\n散步、明确收尾和不再开启新任务，经常一起出现。它们并没有减少工作，却让一天不再只剩下被安排的部分。\n\n## 继续留意\n\n什么样的结束，会让你感觉接下来仍由自己决定？"],
  ["让复杂问题变得可以讨论", "kind-thread", "你在工作中最有能量的时刻，常来自把混乱转成共同的问题。", "## 现在看到的关联\n\n当你先写出假设、顾虑和取舍，讨论会从各自辩护变成一起判断。\n\n## 继续留意\n\n下一次沟通卡住时，先问：大家正在试图保护什么？"],
  ["把照片和速写编成一份小册", "kind-project", "比起完整归档，你更愿意先做出一组可以反复翻看的页面。", "## 当前进展\n\n照片、招牌和速写已经开始出现共同的颜色与节奏。小范围的九到十二页，足够成为第一份作品。\n\n## 保留的开放处\n\n它是否会被分享，以及最后如何命名，都还不急着决定。"],
  ["从执行走向有判断的工作", "kind-thread", "你正在寻找的不是一个头衔，而是能持续参与方向判断的位置。", "## 现在看到的关联\n\n梳理复杂信息、让不同角色说出顾虑、解释取舍，是记录里反复出现且让你有能量的部分。\n\n## 继续留意\n\n哪些真实项目能让这份判断被练习、被验证？"],
  ["旅行里不赶路的停留", "kind-collection", "旅行中没有目的地的停留，正在成为你最想带回日常的经验。", "## 收集到的片段\n\n寺院旁的雨、退潮的海、火车窗外的线和没有攻略的巷子，都指向一种不急着抵达的观看方式。\n\n## 下一次\n\n只预留少量方向，把其余时间交给当天的身体和好奇心。"]
] as const;
const proposals = [
  ["给城市散步做一张小地图", "kind-project", "你已经积累了足够多的步行片段，或许可以先把三条路线并置。", "## 为什么值得保留\n\n这些记录不是旅行攻略，而是在收集能让你慢下来的城市位置。\n\n## 可以从哪里开始\n\n先画出三条曾经愿意折返的路。"],
  ["为职业判断留一份观察笔记", "kind-thread", "关于方向判断、连接不同角色和选择感的记录正在变得清晰。", "## 为什么值得保留\n\n这不是立即换工作的结论，而是一份正在浮现的能力线索。\n\n## 可以继续观察\n\n记下下一个让你愿意承担复杂问题的时刻。"],
  ["做一期不解释的照片与线条", "kind-collection", "照片和速写已经有共同的节奏，适合尝试一份不急着讲明白的小作品。", "## 为什么值得保留\n\n你偏爱的并不是完整叙事，而是让观看者自己停留的空间。\n\n## 可以从哪里开始\n\n从一张云、一段巷子和一页手写文字开始。"]
] as const;
const dateFor = (index: number) => new Date(Date.UTC(2026, 5 + Math.floor(index / 15), 1 + (index % 15) * 2, 10)).toISOString();

await db.transaction().execute(async trx => {
  await trx.insertInto("users").values({ user_id: userId, wx_openid: userId, created_at: now }).onConflict(oc => oc.column("user_id").doNothing()).execute();
  await trx.deleteFrom("entity_relations").where("user_id", "=", userId).execute();
  await trx.deleteFrom("creation_proposals").where("user_id", "=", userId).execute();
  await trx.deleteFrom("creations").where("user_id", "=", userId).execute();
  await trx.deleteFrom("records").where("user_id", "=", userId).execute();
  for (const [kind_id, name, title] of kinds) await trx.insertInto("creation_kinds").values({ kind_id, owner_user_id: null, name, title, created_at: now, updated_at: now }).onConflict(oc => oc.column("kind_id").doNothing()).execute();
  const records = notes.map((text, index) => { const event_at = dateFor(index); return { record_id: randomUUID(), user_id: userId, source: "creation-showcase", content: JSON.stringify({ text, blocks: [] }), version: 1, status: "pending", task_id: null, event_at, created_at: event_at, updated_at: event_at }; });
  await trx.insertInto("records").values(records).execute();
  const creationIds: string[] = [];
  for (const [title, kind_id, summary, content] of creations) { const creationId = randomUUID(); creationIds.push(creationId); await trx.insertInto("creations").values({ creation_id: creationId, user_id: userId, title, kind_id, session_id: "showcase", summary, content, status: "active", version: 1, created_at: now, updated_at: now }).execute(); }
  for (let index = 0; index < 35; index++) await trx.insertInto("entity_relations").values({ relation_id: randomUUID(), user_id: userId, source_entity_id: records[index].record_id, source_entity_type: "record", target_entity_id: creationIds[index % 5], target_entity_type: "creation", relation_type: "record_creation", source_created_at: records[index].created_at, created_at: now }).execute();
  for (const [index, [title, kind_id, summary, content]] of proposals.entries()) { const proposalId = randomUUID(); await trx.insertInto("creation_proposals").values({ proposal_id: proposalId, user_id: userId, creation_id: null, base_creation_version: null, operation: "create", session_id: "showcase", title, kind_id, summary, content, ext_data: JSON.stringify({ schemaVersion: 1 }), status: "pending_confirmation", error: null, created_at: now, updated_at: now }).execute(); for (const record of records.slice(35 + index * 5, 40 + index * 5)) await trx.insertInto("entity_relations").values({ relation_id: randomUUID(), user_id: userId, source_entity_id: record.record_id, source_entity_type: "record", target_entity_id: proposalId, target_entity_type: "creation_proposal", relation_type: "record_creation_proposal", source_created_at: record.created_at, created_at: now }).execute(); }
});
await db.destroy();
console.log("Seeded 50 records, 5 creations, and 3 proposals for creation-demo-user");
