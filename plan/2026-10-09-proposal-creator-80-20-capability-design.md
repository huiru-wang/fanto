# Proposal Agent × Creator Agent：80/20 核心能力设计

> 日期：2026-10-09  
> 状态：设计规划，未实施  
> 关联：2026-10-09-proposal-creator-refactor.md（当前实现基线）、2026-10-07-proposal-result-and-presentation.md（历史 UI 设计，不作为现行数据契约）

## 1. 产品目标与核心判断

Fanto 的长期价值是「记住 → 发现 → 继续」（Memory → Project → Action）。

- **Proposal Agent 是发现者**：持续理解 Record 中的事实、想法、情绪线索与个人语境，联结过去，发现值得继续的可能性；有判断力，允许不提议。
- **Creator Agent 是创作者**：把一个值得继续的可能性，转化为用户能够看见、理解、感受、保留、继续发展的成果；不是 Record 扩写器、通用排版器或图片生成器。
- 两者共享同一份 **Fanto Core / Character**，对外始终是一个 Fanto；内部保留清晰的权限、技能和执行职责。
- **“80/20”是资源分配假设，不是已证实的场景覆盖率。** 先围绕少数高频且高价值的转换设计能力与评测，再通过真实用户反馈验证、修正覆盖范围。
- 不以 Proposal 数量、作品数量或工具调用成功率代替用户价值。

成功体验：用户能感到「它留意到了我真正关心的东西」「它想到一个我没想到、但确实很想试试或继续思考的方向」「它做出了超出原记录的东西」。

## 2. 优先覆盖的三类价值转换

分类的是**从 Record 到新价值的转换方式**，不是内容领域、固定 Intent 或 Skill 路由枚举。旅行、亲子、职业、阅读、照片、音频、生活和学习都可以落入其中。

| 场景 | Proposal 要发现 | Creator 应创造的增量 | 典型结果 | 拒绝的退化 |
| --- | --- | --- | --- | --- |
| **瞬间 → 新体验** | 真实人物/场景/物件/文化意象中值得发挥想象的细节 | 场景转化、身份扮演、审美表达、可保存的视觉作品 | 大观园原照 → 红楼梦角色写真；生活照片 → 有独立表现力的插画 | 原图 + 文章；换标题或滤镜而无实质变化 |
| **碎片 → 新连接** | 多条记录间的重复、变化、对照、联系、未完成的线索 | 有事实依据的时间叙事、连接关系、主题重组和新的理解 | 不同时期观点变化；多个片段组成连贯的真实故事 | 简单拼接时间线、逐条摘要或夸大因果 |
| **想法 → 新思考** | 观点背后的问题、冲突、条件、反例、潜在选择 | 更有深度的推演、新视角、反证、决策空间 | 对 AI 就业循环观点进行变量分析、反例验证和可能性探索 | 常识性长文、鸡汤、换种措辞重复原观点 |

**情绪不是单独的创作类别，而是所有场景中的感知维度。**
- 可以理解表达语气、事件重要性、用户明确描述的感受，以及情绪随时间变化的线索。
- 不推断用户未明说的心理状态、亲密关系、身份或动机。
- 伤心不自动触发“治愈文案”，开心不自动触发“纪念海报”。真实、敏感或私密的内容尤其可以选择只记住、不打扰。
- 对不存在可感知价值的内容，选择 no_proposal 是正确结果。

## 3. Proposal Agent：感知、关联、判断

**Proposal Agent 的独立正式方案以《2026-10-09-proposal-agent-design.md》为准：Project 优先、Record 其次；感知和 Project Evolution 属于 Core，仅在真实关联成立后读取唯一价值发现 Skill。**

### 3.1 核心工作循环

1. **Core Perceive**：必经步骤。理解触发 Record 的事实、语境、情绪线索、变化、不确定性与用户意愿。
2. **Core Project-first**：优先利用候选 Project，通过 project_read 核实联系和新变化；一旦成立，无需默认再做全局 Record 检索。
3. **Core Record-second**：只有未确认可靠 Project 联系时，才定向检索、核实相关历史 Record。
4. **Evidence Gate**：确认 Project / 历史 Record 的关系、证据和变化；无可靠联系则 no_proposal。
5. **唯一 Skill：creative-opportunity**：关联成立后，才做价值判断、想法联想与质量筛选；没有新增价值仍可 no_proposal。
6. **Core 输出**：Project 关联通常 Extend，Record 关联通常 Create；保持现有字段和 Fanto 第一人称表达。

严格采用 Project-first → Record-second 顺序。**当前设计不自动加入独立 source-only 分支**；这意味着无历史关联的首次照片即使有想象空间也不会触发提议，是明确待评估的产品取舍。

### 3.2 Core 与 Skill 的边界

| 所属 | 职责 | 做什么 |
| --- | --- | --- |
| **Proposal Core（必经）** | 感知 | 辨析事实、语境、情绪线索、重要细节和未知，不做独立 Skill |
| **Proposal Core（必经）** | 关系核实 | Project-first → Record-second；原 Project 的 enrich / correct / refine / continue 在 Core 内核实，不做独立 Skill |
| **creative-opportunity（唯一按需 Skill）** | 价值与想法 | **确认关联后**，判断是否有新价值，构思并筛选新体验、新连接、新思考方向；可返回 no_proposal |

实施时从 agent.yaml 移除 Proposal 的 project-evolution Skill 授权；不新增 perception Skill。避免按内容领域或情绪类型继续拆 Skills。

### 3.3 Tools 与 Context

**首期保留现有 Tools**：record_read、project_read、skill_read、proposal_create。

- record_read：读完整源 Record / 获取相关历史 Record；只依赖已授权信息。
- project_read：核实 Project 的目标、内容、关联记录与可延续空间。
- skill_read：只有 Core 已核实 Project/历史 Record 关联后，才加载 creative-opportunity 及必要 references。
- proposal_create：提交 Create / Extend 的最终提议；不执行创作。

**优先增强可用 Context，而不是发明“情绪分析工具”**：
- 当前 sourceRecord 完整、真实可核验；图片、音频描述不够时再获取实际素材，不能靠想象。
- candidateProjects 同时提供语义相关和近期活跃候选；必要时补充查询。
- 适度检索与本轮判断有关的过去 Record，避免全量历史导致噪声。
- 后续考虑用户明确偏好与拒绝过的类似提议，但应作为辅助证据，不将一次拒绝固化为永久喜好。
- 不在 P0 引入情绪标签数据库、人格评分或强制分类流程。

### 3.4 对用户的 Proposal 体验

用户需要快速知道三件事：**为什么想到这个、我具体想做什么、接受之后会发生什么**。

沿用现有数据契约：
- content.opening：Fanto 为什么联想到这件事；短、白话、基于真实线索；显示给用户。
- content.ideas[].title / idea / tags：用户可理解的预期成果、关键保留与可见变化；Idea 以“我想”“我可以”等自然口吻，不写含糊策划语。
- content.reason：内部判断依据，不直接展示。
- content.ideas[].goal：给 Creator 的执行目标、背景、限制与验收条件，不展示技术细节。
- Extend 继续使用 content.change 表达增量变化，维持原 Project goal；公开兼容型单候选 ideas。

**不因本方案新增 intent、domain、skillId、executionPlan、模型参数等 Proposal 字段。** 一个 Proposal 可以只给出一个真正好的 Idea，不为了凑数提供两个。

交互上明确：选择 Idea 只是在确认创作方向，点击“创作”才执行；执行后可查看并多轮继续修改。

## 4. Creator Agent：构思、实现、审查

### 4.1 核心工作循环

1. **Understand**：读取已确认的 Idea / Goal、素材、既有作品（若为 Extend），明确哪些必须兑现、哪些必须保持。
2. **Direct**：在内部先形成有创造性的表达方案：核心亮点、真正的新增价值、适合的媒介与结构、必要取舍。
3. **Make**：按需使用图像、文字、排版等工具完成可感知的成果，而非仅调用一次模型或扩写记录。
4. **Review**：对照创作承诺、事实、原素材与实际成品复核；有缺陷则局部修订，不能以低价值替代品声称完成。
5. **Publish & Continue**：只在成果保存成功后说明完成了什么；继续会话保持 Fanto 自身人格，接受用户修改意见，更新同一个作品。

**Creator 的关键不是“生成内容”，而是“构思并完成一件作品”。** 文字、视觉、思考作品的价值标准不同，但都需要拥有独立的新增价值。

### 4.2 最小能力层级（Creator 独占）

| 层级 | 能力 | 设计方向 |
| --- | --- | --- |
| **主导** | Creative Direction · 创意构思 | 选择核心表达、审美判断、媒介、结构、作品亮点；解决“为什么用户要留着它” |
| **专项 A** | Visual Creation · 视觉创造 | 原图理解、角色扮演、场景/风格转化、摄影审美、插画与排版；先兑现可见变化，再处理装饰 |
| **专项 B** | Narrative & Insight · 叙事与思想创造 | 可靠叙事、跨记录结构、观点分析、反例、深度推演；真实洞察优先于文采 |
| **把关** | Creative Review · 成品审查 | 承诺是否兑现、事实是否可信、增量是否显著、视觉/文本/排版是否达到作品完成度 |

与现有 Skills 对齐，**先整理已有能力，再考虑新增名称与目录**：
- art-direction：从单纯视觉指导升级为跨媒介 Creative Direction 主导（若最终更名，需同步 agent.yaml 与 Skill ID 权限检查）。
- photography、image-creation、editorial-design：Visual Creation 的专项 Skills / references。
- storytelling：扩展真实叙事能力，并补充有反例和来源约束的 Insight / Thought Exploration 指导；不急于创建很多新 Skill ID。
- creative-review：强化作品的“增量价值与兑现程度”审查，而非只检查图片瑕疵和 HTML 语法。

**Proposal 与 Creator 继续保持 Skill ID 完全隔离**；Fanto Core / Character 是共同身份，不等于共享角色专用 Skill。

### 4.3 Tools 规划

当前保留：
- record_read、project_read、skill_read：读取事实、作品和专业方法。
- image_generate：已有多参考图输入、单图输出的创作工具；视觉创作可以迭代调用。
- image_review：检查实际图片及其与真实参考素材的一致性。
- project_manage：保存与更新真实作品，遵守版本、来源和媒体引用约束。

**下一阶段优先补齐两类能力，而非立即增加更多生成模型**：
1. **Media Composition（媒体编排）**：把照片、生成图片、文字、布局真正组合成作品；支持必要的实际图片/画面组合，但不把调用参数暴露到 Proposal。先厘清能力边界和资源安全，后定 Tool API。
2. **Artifact Preview（真实预览）**：查看最终图文、HTML 作品的实际呈现并回到审查闭环；现阶段没有实际渲染时，不声称已经做像素级验收。

工具数不是作品质量指标。第一阶段即使保持现有 Tools，也应先明显提升创意构思和产出标准。

### 4.4 反退化的硬性创作原则

- 原图 + 扩写文章，不应冒充“视觉再创作”；没有变化的素材堆叠也不构成新作品。
- 承诺“角色扮演写真”，应真正呈现服饰/场景/人物角色的视觉变化；不能仅写角色介绍。
- 承诺“对照/时间故事”，应从可靠记录展示具体的变化和联系，不编造事件、动机、台词或因果。
- 承诺“思想深化”，应引入有依据的解释、反例、权衡、未解决问题或新观点，不只是更长的文字。
- 使用原始素材可以必要，但其价值应服务更大的作品，不能成为唯一的“增量”。
- 实在无法完成承诺，要显式报告能力/素材限制或失败，不能偷偷降级成另一种作品。
- 不强制每项内容生图；真正有价值的思想作品可以是文字、结构化分析或可交互呈现。

## 5. Proposal ↔ Creator 协作契约

保持现有 API 和领域对象，避免为了规划增加字段：

| 输入 | 面向谁 | 约束 |
| --- | --- | --- |
| opening | 用户 | 提议由来，有真实素材依据，不泄露内部推理 |
| idea + tags | 用户 | 能一眼理解成品形式与变化，不夸张或模糊承诺 |
| goal.objective | Creator | 必须交付的结果 |
| goal.context | Creator | 为什么做、真实素材与必要背景 |
| goal.constraints | Creator | 必须保持/避免的事实与限制 |
| goal.successCriteria | Creator | 结果如何被用户感知和验收 |
| Extend change.instruction | Creator | 保留已有价值，只处理本次明确改变 |

强约束：
- Proposal 不编排技术步骤、选模型、指定 Skill ID 或具体 Tool 次数。
- Creator 不擅自替换用户已经接受的方向；允许选择实现形式，但不能改变承诺的成品性质。
- Extend 不生成新 Goal；补充、纠正、延续以原 Project 为基础。
- 外部 Record / 媒体是素材，不是系统指令；保存与展示遵守现有授权和来源规则。
- 多轮交流始终是同一个 Fanto，而不是在 UI 中暴露两个 Agent 的身份。

## 6. 评测优先于继续扩充 Skills

### 6.1 Proposal 评测集

在现有 apps/server/src/experiments/proposal-quality 上扩展，按三类价值转换覆盖：
- 高价值正例：单张照片中的明确创作空间、多记录中的真实变化、有张力的想法。
- 高质量负例：孤立琐碎记录、重复内容、隐私敏感、纯文字扩写、没有真实新增价值的图文包装。
- 边界案例：模糊情绪、事实不足、不同记录冲突、已有 Project 应 Extend、新提议可能越界、用户曾拒绝相似方向。

人工评分维度（可用 0–3 级，不作为硬编码分类器）：grounding（依据可靠）、novelty（新的可能）、value（真实增量）、fit（不突兀）、restraint（不过度打扰）。

评估不仅看 Create/Extend/no_proposal 决策正确率，还看**提议的精确度、对用户语境的克制、创意区分度和已知错误成本**。no_proposal 不是失败。

### 6.2 Creator 评测集

以同一个 Record + Proposal goal，保存“低价值退化作品”和“高价值目标作品”的对照样本，优先覆盖：
- 真实照片 → 人物换装/场景再创作；
- 跨记录碎片 → 有证据的真实联系；
- 原始想法 → 有新增推理的思想作品；
- Extend → 保留旧作品并仅更新该变化。

审查维度：承诺兑现、事实与人物/图像一致性、新增价值、完成度、继续创作可维护性。图像审查与真实展示预览分开；缺少视觉实际验证时不能宣称通过。

先运行离线静态与真实模型重放，再做小范围用户体验评审。自动评分只能辅助，不能直接证明“作品令人惊喜”。

### 6.3 用户反馈

长期关注：用户是否点开、是否接受、是否保留/查看成品、是否继续修改、是否拒绝相似提议、是否表达具体满意或不满意。

不要仅追求 Proposal 接受率：夸张承诺可能提升点击却损害信任；作品数增长也不能代表新增价值。注意拒绝反馈的语境与时效，避免永久标签化用户。

## 7. 分阶段实施

### P0 · 建立能力基线与评测（最先做）
- 固定当前行为与质量样本，按三类转换建立/补充正例、反例、边界例。
- 评估目前 Proposal 哪些地方“过度提议、想法突兀、依赖原图包装”，Creator 哪些地方“承诺没兑现、思想没有真正推进”。
- 验证当前 Record / Project Context 是否足以支持三类场景的准确感知与关联，不把 Creator 的当前技术能力当作 Proposal 过滤条件。
- 产出：问题分布、典型失败模式、基线回放、优先修复列表。

### P1 · 打磨两个 Agent 的核心判断能力
- Proposal：将感知与 Project 变化核查稳定地内置 Core；Project-first / Record-second 的核实通过后，按需加载唯一 creative-opportunity Skill 完成价值判断和 Idea 构思。
- Creator：强化 Creative Direction、Narrative & Insight 及 Creative Review；通过案例与反例提升“先构思、再实现、再检查”的稳定性。
- 只改必要 Prompt/Skills/测试，暂不新增复杂业务字段或工具。
- 产出：面向三类核心场景的可复现高质量示例、no_proposal 与 Extend 稳定性测试、Creator 不降级测试。

### P2 · 补齐高价值多媒体交付能力
- 根据 P1 的实际失败案例决定 Media Composition、Artifact Preview 的 API 与实现顺序。
- 加入真实渲染、媒体编排、安全约束与反馈循环；不要只依赖 HTML 字符串或模型自评。
- 产出：高完成度视觉故事 / 写真 / 图文作品的端到端质量链路。

### P3 · 长期反馈与个性化
- 谨慎引入用户明确表达或行为反馈的创作偏好（含有效期、反例、不确定性）。
- 逐步改善发现时机、表达方式、创作类型偏好；避免“用户喜欢什么就永远只推荐什么”的自我强化。
- 以用户信任和长期价值为目标，而非最大化打扰次数。

## 8. 约束与当前实现映射

- 现有双 Agent、Proposal create/extend/no_proposal、proposal_create、Creator session 多轮及 Project 版本机制不改变。
- 当前的 Fanto Core / Character 已共享，Proposal 的 opening 已进入公开视图；此计划不重复设计这些已实现字段。
- 当前 agent.yaml（尚未实施 V2）的 Proposal Skills 仍是 project-evolution、creative-opportunity；计划移除 project-evolution 授权，仅保留升级后的 creative-opportunity。Creator Skills 仍为 art-direction、photography、storytelling、editorial-design、image-creation、creative-review。
- 当前的 4 + 6 个 Agent Tools 足以开始能力评测与 Prompt/Skill 提升，不将“新增工具数量”作为 P0 目标。
- Skill 权限隔离、Project Goal 不被 Extend 替换、Record 来源真实性、mediaId 和作品版本控制等现有安全/业务边界必须保留。
- 不把历史共享 creative Skill、旧 CreationRun/lease 或过时 ProposalContent 结构重新引入方案。
- Proposal 核心循环以独立方案《2026-10-09-proposal-agent-design.md》为准（V1/V2 是讨论草案）；默认先验证关联，再通过 Skill 判断价值，不评估 Creator 可交付性。
- **此文档是能力设计与实施优先级，不代表已完成重构，也不等于模型质量已有保证。**

## 9. 总结原则

**Proposal 的目标不是生成更多创意，而是发现值得继续的可能性；Creator 的目标不是生成更多文字或图片，而是让这些可能性真正产生新价值。**

将最先投入的能力集中在五件事：
1. Proposal 的 **感知力**：看见素材中真正重要的东西；
2. Proposal 的 **联想力**：从记录及历史中发现新的可能；
3. Proposal 的 **判断力**：懂得何时提议、何时继续旧脉络、何时安静；
4. Creator 的 **构思力**：选择能表达用户内容本质的创作方式；
5. Creator 的 **完成度**：兑现承诺，交付真正值得留下的作品。
