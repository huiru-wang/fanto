# Proposal Agent + Shared Creative Skill 改造方案

基线：a61be22 之后当前工作区

## 1. 目标状态

proposal-agent 与 creator-agent 共用同一个 Skill：

~~~yaml
proposal-agent:
  tools: [record_read, project_read, proposal_create, skill_read]
  skills: [creative]

creator-agent:
  tools: [record_read, project_read, image_generate, creation_prepare, creation_publish, skill_read]
  skills: [creative]
~~~

Skill 目录：

~~~text
apps/server/skills/creative/
├── SKILL.md
└── references/
    ├── roleplay.md
    ├── art-poster.md
    ├── postcard.md
    ├── photo-story.md
    ├── storybook.md
    ├── birthday-memory.md
    ├── anniversary.md
    └── then-and-now.md
~~~

不再维护：
- creative-proposal Skill
- roleplay-article Skill
- 独立 art-poster / postcard / storybook 等 Creator Skills

---

## 2. Proposal / Project

保持现有 ProposalContent，不增加 domain、intent、skillId 或执行参数。

~~~ts
interface ProposalContent {
  reason: string;
  idea: string;
  plan: string[];
  creation?: {
    objective: string;
    context?: string;
    constraints?: string[];
    successCriteria?: string[];
  };
}
~~~

保持现有 Proposal / Project / CreationRun / executionPlan / lease / recovery。

---

## 3. Skill Runtime

继续复用 Pi Core：
- resources.skills
- lane.skill(...)

Fanto 保留：
- available_skills 轻量索引
- skill_read 安全读取 Skill 包文件
- runAgentSkill 显式调用 Skill

skill_read 只能读取当前 AgentDefinition.skills 中声明的 Skill：
- SKILL.md
- references/**

禁止：
- 绝对路径
- ..
- symlink escape
- 其他 Skill
- workspace / server 任意文件

---

## 4. proposal-agent

CreativeRunner proposal role：

~~~text
runAgentSkill(
  proposal-agent,
  "creative",
  ...
)
~~~

proposal-agent prompt 只保留通用 Proposal 规则：
- 事实来源约束
- 每次最多一个 Proposal
- 不强制提议
- recordIds 必须已完整读取
- create / extend 契约
- creation 只保存 objective/context/constraints/successCriteria
- 成功 proposal_create 后停止
- 无价值时 no_proposal

具体创意判断全部由 shared creative Skill 负责。

---

## 5. creator-agent

creator-agent 普通运行，通过 available_skills 知道 shared creative Skill。

执行流程：

~~~text
creation_context
  ↓
读取授权 Record
  ↓
根据 creation goal 判断创意方向
  ↓
skill_read("creative", "references/{direction}.md")
  ↓
按 reference Execution 执行
  ↓
creation_prepare
  ↓
image_generate
  ↓
creation_publish
~~~

creator-agent 不：
- 搜索额外历史 Record
- 修改 Proposal
- 扩大 creation goal
- 保存或依赖 intent 字段

---

## 6. creative/SKILL.md

同一个 SKILL.md 同时定义两个阶段。

### Proposal 阶段

~~~text
读取 Trigger Record
  ↓
校验素材可执行性
  ↓
识别 Creative Signals
  ↓
推导 Creative Affordances
  ↓
比较少量创意方向
  ↓
读取对应 reference
  ↓
可选历史 Record 检索
  ↓
Project create / extend 判断
  ↓
proposal_create
~~~

Creative Signals：
- visual
- cultural
- occasion
- temporal
- story

Creative Affordances：
- subject transformation
- cultural roleplay
- scene stylization
- visual design
- memory composition
- storytelling
- temporal comparison
- style transformation

### Creator 阶段

~~~text
读取 confirmed creation goal
  ↓
判断对应创意方向
  ↓
读取同一 reference
  ↓
按 Execution 部分执行
  ↓
publish
~~~

---

## 7. Reference 契约

每个 reference 同时包含：

~~~text
# Direction

## Proposal
- 适用条件
- 不适用条件
- 历史检索策略
- Proposal 写法
- 当前能力约束

## Execution
- 素材选择
- 图片生成指导
- 身份/事实保持
- Markdown / html-preview 组织方式
- publish 要求
~~~

---

## 8. 创意方向

| Reference | Proposal 触发 | 历史检索 |
|---|---|---|
| roleplay | 人物 + 历史/文学/动漫/影视/游戏/主题场景 | 默认否 |
| art-poster | 风景/建筑/城市/植物/光影/强构图 | 否 |
| postcard | 明确旅行地点 + 图片 | 否 |
| photo-story | 同一次经历多图且有叙事关系 | 可选 |
| storybook | 儿童/宠物/互动场景 | 否 |
| birthday-memory | 明确生日 + 可执行图片 | 最多 2 次 |
| anniversary | 明确周年/纪念日 + 可执行图片 | 最多 2 次 |
| then-and-now | 可确认跨时间同人/同地/同事件 | 通常需要 |

当前执行约束：
- 最多 3 张源图
- 生成 1–3 张图片
- 图片模型不负责复杂文字排版
- 复杂文字和版式使用 Markdown / html-preview
- 所有事实来自已读 Record

---

## 9. CreativeService

proposal context 只暴露能力：

~~~json
{
  "maxProposals": 1,
  "capabilities": {
    "referenceImageCreation": true,
    "maxSourceImages": 3,
    "maxGeneratedImages": 3,
    "projectMarkdown": true,
    "htmlPreview": true,
    "imageTextRendering": false
  }
}
~~~

createProposal 保持现有校验，不增加 intent / skill 路由：
- creation 必填
- Trigger Record 必须引用
- recordIds 已读取
- version 校验
- 至少一个有 description 的 image

---

## 10. 文件状态

保留 / 修改：

~~~text
apps/server/agent.yaml
apps/server/src/agent/harness/build-runtime.ts
apps/server/src/agent/harness/definition.ts
apps/server/src/agent/harness/run.ts
apps/server/src/agent/harness/session-manager.ts
apps/server/src/agent/skills/loader.ts
apps/server/src/agent/tools/skills.ts
apps/server/src/agent/tools/index.ts
apps/server/src/agent/tools/creative.ts
apps/server/src/agent/prompts/proposal-agent.ts
apps/server/src/agent/prompts/creator-agent.ts
apps/server/src/creative-runtime/runner.ts
apps/server/src/creative-runtime/service.ts
apps/server/skills/creative/**
~~~

删除旧 Skills：

~~~text
apps/server/skills/creative-proposal/
apps/server/skills/roleplay-article/
apps/server/skills/art-poster/
apps/server/skills/postcard/
apps/server/skills/photo-story/
apps/server/skills/storybook/
apps/server/skills/birthday-memory/
apps/server/skills/anniversary-memory/
apps/server/skills/then-and-now/
~~~

---

## 11. 测试

Skill Runtime：
- proposal-agent.skills = [creative]
- creator-agent.skills = [creative]
- skill_read 只能读取 creative
- 拒绝绝对路径 / .. / symlink escape
- lane.skill("creative") 可用于 proposal role

Proposal：
- roleplay
- art-poster
- postcard
- photo-story
- storybook
- birthday-memory
- anniversary
- then-and-now
- 无可执行图片 → no proposal
- 普通流水 Record → no proposal

Creator：
- 根据 creation goal 选择正确 creative reference
- 只使用授权 Record
- 不检索额外历史
- executionPlan 不变
- 生成图全部发布
- 复杂文字走 Markdown / html-preview

---

## 12. 验收

1. proposal-agent 和 creator-agent 只声明 shared creative Skill
2. 所有创意方向都在 creative/references 下
3. Proposal / Project schema 不变
4. Creative Runtime 可靠性机制不变
5. proposal-agent 显式 lane.skill("creative")
6. creator-agent 根据 creation goal 读取 creative reference
7. 不存在独立 Creator Skill
8. typecheck 通过
9. server tests 通过

