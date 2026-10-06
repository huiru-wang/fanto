# 基于 Records 的内容创作

## 目标

Fanto 不从“给 AI 一个题目，让它生成内容”出发，而是利用用户长期积累的 Records：

```text
Record
  ↓
发现值得表达的内容
  ↓
Creation Proposal
  ↓ 用户确认
Content Creation Project
  ↓
持续创作与迭代
```

核心价值：**帮助用户发现“过去其实已经有东西值得说”，再把这些真实材料组织成作品。**

---

## 1. 发现 Discovery

Discovery 负责判断：**哪些 Record，或哪些 Record 之间的关系，已经形成值得继续创作的内容机会。**

它只负责发现机会，不负责直接生成作品。

发现结果应至少能够说明：

- **值得表达什么**：能够形成一句清晰的核心表达；
- **为什么属于用户**：来自用户真实经历、观点、语言或变化，而不是通用话题；
- **依据是什么**：能够指出支撑这次发现的一条或多条 Record。

满足价值门槛后，形成 Creation Proposal；价值不足时保持安静。

### Record-driven 输入增强优先级

为提升 Discovery 对真实生活连续性的理解，当前先确认：

- **P0：Location**。Record 需要能够携带地点信息，用于发现同地点重复出现、旅行路线、空间连续性与地点相关经历。
- **P1：Face Clustering**。图片中的人脸优先做“同一人物聚类 / 连续性识别”，先识别 same person，不主动推断身份或关系；后续可由用户明确命名。

### 当前待继续讨论

Discovery 暂不确定具体实现和判断规则，后续重点讨论：

- 单条 Record 什么情况下足够形成创作机会；
- 多条 Record 之间哪些关系最值得识别；
- 如何区分“主题相似”和真正的“表达价值”；
- 如何控制 Proposal 的质量、频率和误判；
- 新 Record 到来后，如何与历史 Record 形成新的创作机会。

---

## 2. 创作 Creation

用户确认 Proposal，或主动提出基于 Records 创作后，进入 Content Creation Project。

创作过程先按一套稳定方法执行，可沉淀为 `record-based-creation` Skill。

### 创作方法

#### 1. 创作主张

先确定作品真正想表达什么，而不是直接生成大纲。

目标是形成一句清晰、有用户个人判断的核心表达。

#### 2. 素材脉络

从相关 Records 中选择真正有用的素材，并理解它们在作品中的作用，例如：

- 起点 / 背景
- 具体故事或画面
- 原话
- 证据
- 冲突
- 观点转折
- 当前结论

Record 不是附件，而是作品内容、观点和叙事成立的依据。

#### 3. 作品结构

围绕核心表达组织作品，而不是套固定模板。

例如：

```text
起点 → 怀疑 → 转折 → 新判断
```

或：

```text
具体经历 → 问题 → 思考 → 结论
```

结构应服务于这一次作品，而不是固定为通用章节。

#### 4. 当前作品

完成真实可使用的作品，并在 Project 中持续迭代。

核心作品可以继续派生为不同表达形式，例如文章、视频脚本、PPT、社交内容等，但不默认一次生成全部。

---

## 3. Creation Project 的核心内容

Creation Project 首期保持克制，重点只保留四类内容：

1. **创作主张**：这次真正想表达什么；
2. **素材脉络**：哪些 Records 构成作品，以及它们之间的关系；
3. **作品结构**：作品正在如何展开；
4. **当前作品**：当前版本的最终内容。

Proposal 与 Active Project 使用同一套内容表达；区别只在 Project 状态和用户是否已经确认继续。

---

## 4. 职责边界

```text
Discovery
= 判断“这值得写”

Proposal
= 把创作机会交给用户决定是否继续

Creation Project
= 承载这件作品的长期上下文和持续演化

record-based-creation Skill
= 定义“如何基于 Records 把作品创作好”

Task
= Project 中某一次具体创作或加工执行
```

当前优先级：**创作逻辑先按本方案推进；Discovery 继续产品讨论后再定。**

---

## 5. Record-driven Discovery：实体图思路

### 核心抽象

Discovery 不把 Record 作为需要彼此建立相似边的主节点。

更自然的理解是：

- **实体是节点**：例如人物、地点、概念、事件、活动等；
- **Record 是一次真实发生过的关系证据**；
- 一条 Record 可以同时关联多个实体，因此概念上更接近一条连接多个节点的 **Hyperedge（超边）**。

例如一条 Record：

```text
“今天和老婆去了西湖。”
```

理解后可能包含：

```text
me
face_1 / 老婆
西湖
杭州
```

这条 Record 本身就是这些实体在这一时刻共同出现、共同发生关系的证据。

### 新 Record 到来后的流程

```text
New Record
   ↓
1. Record Understanding
   ↓
识别其中的实体与上下文
   ↓
2. Entity Resolution
   ↓
判断实体是新实体还是已有实体
   ↓
3. Attach Record
   ↓
Record 作为 Evidence / Hyperedge 连接这些实体
   ↓
4. Update Local Graph
   ↓
观察本次 Record 让局部关系发生了什么变化
   ↓
5. Meaningful Change Evaluation
   ↓
判断这次变化是否值得继续关注
   ↓
6. Opportunity
   ↓
Proposal
```

### Discovery 关注的是图结构变化

新 Record 可能带来四类主要变化：

1. **Emergence**：过去不存在的实体关系第一次出现；
2. **Reinforcement**：已有关系被新的 Record 再次证明，关系逐渐增强；
3. **Resurface**：沉寂较久的实体关系重新出现；
4. **Bridge**：原本相对独立的两个实体簇，因为一条新 Record 第一次产生连接。

其中优先关注：

- **Reinforcement**：适合发现长期人物关系、兴趣、习惯、长期主题；
- **Bridge**：适合发现跨领域的新联系、观点突破和潜在创作机会。

### 关系强度不等于 Discovery 价值

同一实体关系关联更多 Record，只表示这段关系得到更多真实记录支撑，但不意味着一定值得产生 Proposal。

例如：

```text
me ↔ 杭州
```

即使关联大量 Record，也可能只是因为用户长期生活在杭州，没有新的表达价值。

而：

```text
me ↔ face_1
```

如果在较长时间跨度、多个地点和多种生活场景中持续出现，则可能逐渐形成值得继续理解的长期关系。

因此需要区分：

```text
Relationship Strength
```

与：

```text
Discovery Value
```

关系强度可考虑：

- 支撑 Record 数量；
- 时间跨度；
- 场景多样性；
- 最近活跃度；
- Record 内容丰富度。

Discovery Value 还应进一步考虑：

- 新颖性；
- 关系变化幅度；
- 是否形成跨域 Bridge；
- 是否能够形成清晰的新理解或表达；
- 是否值得此刻打扰用户。

### Creation Proposal 示例

如果 `me ↔ face_1` 已被多条 Record 长期支撑，并覆盖旅行、日常、节日等不同场景，可以形成类似：

```text
这一年，你们一起经历的这些小事已经逐渐形成了一段完整的共同记忆。
```

如果多个关于 Fanto、Memory、Project、Action 的概念在不同 Record 中不断重新组合，并逐渐收敛，可以形成：

```text
你对个人 AI 的理解已经从“自动整理记录”逐渐变化为“记住 → 发现 → 继续”。
```

Proposal 不是由 Record 数量或图权重直接触发，而是由**图结构出现了值得用户继续关注的意义变化**触发。

### 当前输入增强优先级

- **P0：Location**。用于丰富地点实体、空间连续性、旅行路线和重复到访关系。
- **P1：Face Clustering**。用于建立 same-person 连续性；优先识别“这是同一个人”，不主动推断身份或关系，后续可由用户明确命名。

### 当前暂不确定

后续继续讨论：

- 实体类型需要做到什么粒度；
- 哪些实体值得长期稳定化，哪些只作为一次性上下文；
- Entity Resolution 如何避免错误合并；
- Relationship Strength 与 Discovery Value 的具体判断方式；
- 哪些图结构变化足以生成 Proposal；
- Creation / Research / Tracking / Thread 是否共享同一套 Discovery Graph。

---

## 6. 三条 Record 的完整 Discovery 示例

### Record 1

用户记录：

```text
周末和老婆去了西湖边散步，天气很好，后来在湖滨吃了饭。
```

输入包含：

```text
时间：2026-04-12
地点：西湖 / 杭州
图片：用户本人、老婆、西湖边
```

理解出的实体：

```text
me
person_2
西湖
杭州
散步
吃饭
```

Record 与实体建立关联：

```text
r1 -> me
r1 -> person_2
r1 -> 西湖
r1 -> 杭州
r1 -> 散步
r1 -> 吃饭
```

此时只形成一次真实关系证据，不生成 Proposal。

### Record 2

三个月后记录：

```text
今天又和老婆去了西湖，这次骑车绕了一圈。感觉她现在比我更喜欢骑车。
```

输入包含：

```text
时间：2026-07-19
地点：西湖 / 杭州
图片：与 Record 1 中相同的 person_2、自行车、西湖
```

理解出的实体：

```text
me
person_2
西湖
杭州
骑车
```

建立关联：

```text
r2 -> me
r2 -> person_2
r2 -> 西湖
r2 -> 杭州
r2 -> 骑车
```

此时可以从 Record 证据动态看到：

```text
me <-> person_2
shared records: r1, r2

person_2 <-> 西湖
shared records: r1, r2

me <-> 西湖
shared records: r1, r2
```

关系得到 Reinforcement，但仍不一定值得生成 Proposal。

### Record 3

再过三个月记录：

```text
今天整理照片才发现，今年和老婆已经来了三次西湖。以前总觉得杭州没什么地方可去，现在反而越来越喜欢这种周末随便出来走走的感觉。
```

输入包含：

```text
时间：2026-10-03
地点：西湖 / 杭州
图片：me、person_2、西湖、傍晚
```

理解出的实体与语义：

```text
me
person_2
西湖
杭州
周末散步
对杭州的感受变化
```

建立关联：

```text
r3 -> me
r3 -> person_2
r3 -> 西湖
r3 -> 杭州
r3 -> 周末散步
r3 -> 对杭州的感受变化
```

此时局部关系得到进一步增强：

```text
me <-> person_2
shared records: r1, r2, r3
时间跨度约 6 个月

person_2 <-> 西湖
shared records: r1, r2, r3

me <-> 西湖
shared records: r1, r2, r3
```

同时出现新的意义：

```text
共同人物关系持续存在
+
同一地点反复出现
+
不同活动：散步 / 骑车 / 吃饭
+
时间跨度扩大
+
用户对杭州周末生活的主观感受发生变化
```

Discovery 此时再读取 r1、r2、r3 的原始内容，形成 Creation Opportunity：

```text
核心发现：
用户和同一个人反复在西湖留下共同经历，同时用户对杭州周末生活的感受发生了变化。

证据：
r1, r2, r3
```

最终可以生成 Proposal：

```text
我们好像已经不知不觉去了很多次西湖。

从第一次散步、后来一起骑车，到现在你开始觉得“周末随便出来走走”本身就是一种喜欢杭州的方式。

要不要把这些记录整理成一篇关于你们在杭州周末生活的小文章？
```

用户确认后进入 Content Creation Project，关联 r1、r2、r3。

### 这套流程的当前原则

```text
原始事实：Record

Record Understanding：识别 Record 中的人、地点、活动、概念等实体与上下文

Entity Resolution：识别新实体或复用已有实体

Record -> Entity：Record 作为真实关系证据连接多个实体

Relationship Strength：由多条 Record 动态形成，不直接作为原始事实存储

Discovery：关注新 Record 是否让局部实体关系出现 Emergence / Reinforcement / Resurface / Bridge

Opportunity：对有意义的图结构变化再次读取原始 Record，形成用户可理解的发现

Proposal：只有 Opportunity 足够明确、有真实 Record 支撑、值得此刻打扰用户时才出现
```


---

## 6. Entity / Relation 最小存储方案

当前先采用最小模型，不提前固化统计字段。

### Record

`records` 增加 `entities` JSON 字段，保存该 Record 当前识别出的可读实体快照：

```text
[
  { entityId, type, name },
  ...
]
```

Record 仍然是事实源。

### Entity

`entities` 保存稳定实体，当前顶层类型固定为：

```text
person
place
organization
activity
thing
concept
```

最小字段：

```text
entity_id
user_id
type
name
identity_key
record_count
ext_data
created_at
updated_at
```

`record_count` 保留，用于快速判断实体在历史 Records 中出现的频率。

### Entity Relation

`entity_relations` 当前只承担“两个实体已经被 Record 共同连接过”的最小关系索引，不提前存统计信息。

最小字段：

```text
relation_id
user_id
entity_a_id
entity_b_id
ext_data
created_at
updated_at
```

约束：

```text
UNIQUE(user_id, entity_a_id, entity_b_id)
```

`entity_a_id / entity_b_id` 固定按同一顺序写入，避免重复关系。

当前不存：

```text
record_count
first_seen_at
last_seen_at
last_record_id
relationship_strength
discovery_score
```

这些信息暂时都从 `records.entities`、`entities.record_count` 以及原始 Records 动态计算。后续只有在 Discovery 逻辑明确、确实存在性能或查询需求时，再决定哪些统计值得物化。

### 当前 Discovery 方向

新 Record 到来后：

```text
Record Understanding
  ↓
Entity Extraction / Resolution
  ↓
写入 records.entities
  ↓
更新 entities / entity_relations
  ↓
只检查本次受影响的局部 Entity Graph
  ↓
从原始 Records 计算关系强弱和变化
  ↓
语义判断是否形成 Opportunity
  ↓
Proposal
```

Relation 表当前只解决“存在连接”，不承担“连接有多强、何时形成、是否有价值”的判断。
