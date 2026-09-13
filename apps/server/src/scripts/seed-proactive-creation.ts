import { randomUUID } from "node:crypto";
import { loadConfig, loadEnv } from "../env.js";
import { createDatabase } from "../infrastructure/database.js";
import { nowIso } from "../infrastructure/time.js";

const userId = "proactive-test-user";
const source = "proactive-creation-fixture";
const texts = [
  "周一晚上九点半，我把手机放到客厅，只带电脑进书房。房间里只有台灯和风扇声，四十五分钟内写完了原本拖了两天的接口说明。结束时没有兴奋，更多是一种终于回到自己节奏里的安静。",
  "周二下班后直接坐在餐桌前继续写。家人看电视、消息不断弹出，我每十分钟就切换一次窗口。两个小时看起来很长，实际只改了几行，后来开始怀疑是不是自己根本不适合晚上做需要思考的事。",
  "周三试着在开始前写下一个很小的目标：只梳理一个页面的交互状态。书房门关上后，二十五分钟就完成了。目标足够小似乎降低了启动阻力，但我还不能判断是目标起作用，还是那天本来精力比较好。",
  "周四睡得很差，下午已经很烦躁。晚上即使回到书房，也只盯着屏幕发呆。环境没有解决疲惫，说明安静可能只是让我更容易进入状态，而不是保证能完成工作。",
  "周五没有安排任何产出，只整理这一周的笔记。发现那些顺利完成的晚上都有一个共同点：开始前至少有二十分钟没有处理工作消息。也许真正要保护的是从工作角色切换出来的空白。",
  "周六上午去咖啡馆写了一小时。周围很吵，但每个人都在做自己的事，反而没有被打断。和书房相比，这里没有独处，却有一种不需要解释自己在做什么的安全感。",
  "周六晚上回家后想复制咖啡馆的效率，却失败了。白天已经完成不少任务，晚上不再有继续证明自己的压力。我没有强迫自己开工，改成把白天想到的三个问题记下来，心情反而轻松。",
  "周日把桌面收拾干净，删除了几个不用的软件通知。晚上开始前还是会下意识打开聊天工具。以后可以观察，真正打断我的到底是声音、视觉提示，还是担心错过别人的回应。",
  "下周一晚上，朋友临时约我吃饭。我回来很晚，但因为白天已经决定不追赶进度，就只读了几页资料。以前我会把这种晚上视作失败，现在更愿意把它当成节奏里正常的空档。",
  "下周二在书房工作五十分钟，卡在一个技术细节上。想放弃时没有去刷信息，而是写下卡住的原因、查证路径和明天的第一步。虽然没有完全解决问题，但第二天回看时很容易重新进入。",
  "下周三我尝试把晚上分成两个阶段：先散步十分钟，再做三十分钟创作。散步回来时仍然疲惫，但注意力比直接坐下更稳定。这里可能还有晚餐、天气和当天会议数量等因素，不能只归因于散步。",
  "下周四客厅很安静，家里人都出门了。我却依旧没有进入状态，因为白天的会议让我一直在反复回想一段不愉快的对话。这提醒我，物理环境和心理残留是两条不同的线索。",
  "下周五完成了一个小功能后，没有立刻开始下一个任务，而是记录了为什么这次能持续投入：范围明确、没有人催、能看见完成后的效果。也许我需要的不只是安静，而是可完成的边界。",
  "周六下午和同事聊到个人项目。他说可以每周互相展示一次进展。我第一反应是抗拒，担心这会把原本私人的创作变成考核；但也好奇适度的见证会不会帮助我持续。",
  "周六晚上试着做了一张很粗糙的进展图，只标记开始时间、地点、是否被打断和结束后的感受。数据很少，但已经能看出书房不是总能带来高效率，睡眠不足那次是明显反例。",
  "周日没有写代码，而是把一个长期想做的功能拆成四个小实验。以前我习惯先设想完整产品，结果每次都被规模吓住。现在把它叫作实验后，开始的感觉轻了一些。",
  "第三周周一，晚饭后先花十五分钟写日记，再进入项目。日记里写了当天最消耗我的会议，写完后脑子没有那么吵。也许记录本身能承担一种清场作用，但目前只是一次体验。",
  "第三周周二，书房窗外施工到十点。我戴上耳机仍然分心，最后把任务换成整理素材而不是写核心逻辑。根据当下状态调整任务类型，比硬撑着完成原计划更少挫败感。",
  "第三周周三，和朋友约定周末交换各自的一个小成果。想到有人会看，我白天就开始收集素材；但晚上真正执行时并没有额外焦虑。这个例子和我之前对外部期待的担心不完全一致，值得继续观察。",
  "第三周周四，我在书房完成了本周最难的一段工作。开始前关了通知、写下单一目标、先走了十分钟，缺少任何一个条件会怎样还不知道。现在的结论只能说，这组准备动作似乎比单纯晚间时间段更关键。",
];

loadEnv();
const config = loadConfig();
const db = createDatabase(config.sqlitePath);
const now = nowIso();

await db.transaction().execute(async trx => {
  const user = await trx.selectFrom("users").select("id").where("user_id", "=", userId).executeTakeFirst();
  if (!user) await trx.insertInto("users").values({ user_id: userId, wx_openid: userId, created_at: now }).execute();
  await trx.deleteFrom("records").where("user_id", "=", userId).where("source", "=", source).execute();
  await trx.insertInto("records").values(texts.map((text, index) => ({
    record_id: randomUUID(), user_id: userId, source, content: JSON.stringify({ text, blocks: [] }), version: 1, status: "pending", task_id: null,
    created_at: new Date(Date.parse(now) + index * 1_000).toISOString(), updated_at: now,
  }))).execute();
});

await db.destroy();
console.log(JSON.stringify({ userId, insertedRecords: texts.length }));
