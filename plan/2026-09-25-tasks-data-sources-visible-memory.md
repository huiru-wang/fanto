# Fanto 下一阶段产品迭代：任务、数据源与可见记忆

> 日期：2026-09-25
> 状态：初步产品规划 / 待进一步设计
> 参考：Today.ai 的 Personal Agent 产品形态，但不以复刻 Today 为目标。
> 目标：让 Fanto 从“能聊天、能记住”进一步变成一个能力可见、数据可授权、记忆可控制的长期个人智能。
> 非目标：本阶段不一次性做完整 Personal OS，不追求大量 Connector，不设计复杂工作流编辑器，也不把 Agent 内部执行细节直接暴露给用户。

---

## 1. 核心方向

本轮聚焦三个相互关联、但可以独立迭代的能力：

1. **任务显化**：Chat 页面顶部增加“聊天 / 任务”两个 Tab，用户能看到交给 Fanto 的长期任务，以及历史执行结果。
2. **数据源授权**：允许用户主动授权 Fanto 读取更多个人上下文，例如日历、提醒事项、健康数据、本地文件等。
3. **记忆显化**：让用户看到“Fanto 记住了什么”，并允许查看来源、修改和删除。

最终链路：

~~~mermaid
flowchart LR
  S[用户授权的数据源] --> C[Personal Context]
  R[Record / Conversation] --> C
  C --> M[长期记忆]
  M --> F[Fanto]
  C --> F
  F --> T[任务]
  T --> TR[任务执行记录]
  TR --> F
~~~

产品感受应该是：

> **我知道它能看到什么、记住了什么、正在替我做什么，并且这些都由我控制。**

---

## 2. Chat 顶部增加“聊天 / 任务”

### 2.1 页面结构

Fanto Chat 页面顶部增加轻量切换：

~~~text
           Fanto

      [ 聊天 ] [ 任务 ]

--------------------------
页面内容
~~~

“聊天”保持当前体验，不变成复杂 Agent 工作台。

“任务”展示用户明确交给 Fanto 的持续任务，以及已经发生过的执行记录。

第一版可简单分为：

~~~text
任务
├─ 进行中
│  ├─ 每周三晚上提醒我练琴
│  ├─ 每天早上给我整理今日安排
│  └─ 每周日总结本周记录
│
└─ 最近执行
   ├─ 今日安排 · 今天 08:03 · 已完成
   ├─ AI 简报 · 昨天 08:01 · 已完成
   └─ 练琴提醒 · 周三 19:00 · 已完成
~~~

暂时不需要复杂筛选、项目分类或工作流画布。

### 2.2 Product Task

用户可见任务至少包含：

~~~text
Task
- 名称
- 用户意图 / instruction
- 触发方式
- 状态
- 下次执行时间
- 最近一次执行状态
- 创建时间
~~~

第一版只重点支持时间型任务：

- 单次定时；
- 每日；
- 每周；
- 简单周期。

后续再扩展条件触发、数据变化触发和外部事件触发。

### 2.3 任务详情

详情页只需要回答：

> 这个任务要做什么？什么时候执行？是否还在运行？过去做过什么？

建议展示：

~~~text
每周三提醒练琴

状态        运行中
计划        每周三 19:00
下次执行    9 月 30 日 19:00

任务内容
提醒我晚上练琴。如果我回复今天不练，不要继续催促。

最近执行
09/23 19:00   已完成
09/16 19:00   已完成
09/09 19:00   已完成
~~~

第一版操作：

- 暂停 / 恢复；
- 修改；
- 删除；
- 查看某次执行详情。

### 2.4 Task Run

Task 与每次实际执行分开：

~~~text
Task
    |
    +-- TaskRun #1
    +-- TaskRun #2
    +-- TaskRun #3
~~~

TaskRun 至少记录：

- 什么时候触发；
- 为什么触发；
- 是否成功；
- Fanto 最终做了什么；
- 用户可见结果。

TaskRun 面向用户表达，不暴露 Prompt、reasoning、token、内部 Tool Call 和 Runtime Log。

### 2.5 创建入口

第一版坚持 **Conversation First**。

用户直接说：

> 以后每周三晚上提醒我练琴。

Fanto 确认后创建任务。

任务页主要承担“查看和管理”，暂时不建立复杂的自动化配置器。

### 2.6 与当前 Agent Runtime Task 的边界

当前 Agent Runtime 已有异步 Task，但它是运行时机制，不是产品中的用户任务。

后续实现应明确：

~~~text
Product Task
= 用户长期委托 / schedule / state

Task Run
= Product Task 的一次执行

Agent Runtime Task
= 底层某次异步 Agent execution
~~~

不能直接把 Runtime Task 暴露成产品 Task。

---

## 3. 数据源授权

### 3.1 产品入口

设置中增加：

~~~text
设置
└─ 数据与隐私
   ├─ 数据源
   └─ 导出我的记录
~~~

数据源页面可以是：

~~~text
数据源

已连接
  日历                已连接
  提醒事项            已连接

可连接
  健康                连接
  文件                连接
  App 使用情况        暂未开放
  笔记                暂未开放
~~~

每种数据源都必须由用户明确授权，而不是 Fanto 默认扫描设备。

### 3.2 每个数据源都要回答三件事

1. **能读取什么**：不能只写“读取健康数据”，要明确睡眠、步数、运动等范围。
2. **为什么需要**：解释它会在哪些场景被使用。
3. **如何停止**：允许关闭、调整授权，并说明停止后历史数据和已形成记忆如何处理。

### 3.3 第一批数据源优先级

#### P0：Fanto 自身数据

已有或将有：

- Record；
- Conversation；
- Preference；
- Task / TaskRun。

这些构成 Fanto 自己的 Personal Context。

#### P1：Calendar

优先级最高，可用于：

- 今日安排；
- 时间冲突；
- 决定提醒时机；
- 会议前后的上下文；
- 回答“我明天下午有空吗”。

第一版以读取为主，创建和修改日程后置。

#### P1：Reminders / Todo

价值：

- 理解用户当前明确要做什么；
- 避免 Fanto 重复提醒；
- 后续可以和 Product Task 建立关系。

第一版同样以读取为主。

#### P2：Health

第一版只读取少量高价值数据：

- 睡眠；
- 步数 / 活动；
- Workout。

不需要一次接大量 HealthKit 类型。

健康信息只在真正相关时进入 Agent Context，不能为了展示“懂你”而频繁提及。

#### P2：Local Files

第一版定义为：

> 用户主动选择文件或目录交给 Fanto。

不是允许 Fanto 扫描整个设备。

#### P3：App Usage

有价值但敏感，而且平台限制更多，例如屏幕使用时间、App 使用时长和使用规律。

不作为本轮 MVP 阻塞项，先单独验证 Screen Time / Family Controls / Device Activity 的能力和上架权限。

#### P3：Notes

“笔记”需要继续拆分：

- Fanto Record；
- 用户主动导入的文本 / 文件；
- 第三方笔记服务；
- 系统 Notes。

第一版不要抽象成“读取手机所有笔记”。

---

## 4. 数据源不等于 Record，也不等于 Memory

这是数据源设计最重要的边界。

Calendar 可能有数千条事件，HealthKit 可能有大量 Samples，不应该全部写成 Record 再全部做 embedding。

更合理的是：

~~~mermaid
flowchart LR
  DS[Data Source] --> P[Source Provider]
  P --> C[按需 Context]
  P --> D[重要信息提炼]
  D --> M[Memory]
  C --> A[Agent]
  M --> A
~~~

三层含义：

- **原始数据**：仍属于数据源本身。
- **Context**：当前 Agent / Task 真正需要时按需读取。
- **Memory**：只有跨时间仍然有价值的信息才进一步沉淀。

例如“昨晚睡眠 5h42m”通常只是短期 Context，不应该自动成为长期 Memory。

---

## 5. 记忆显化与可编辑

### 5.1 产品目标

Memory 页面不是“Fanto 保存的所有数据”，而是：

> **Fanto 当前认为未来可能持续有用的、关于我的长期信息。**

用户应该能直接回答：

- 它记得我什么？
- 为什么会记得？
- 记错了怎么办？
- 我不想让它记怎么办？

### 5.2 第一版形态

可先在“设置 → Fanto”或“数据与隐私”中增加“记忆”入口，最终位置等 UI 设计时再定。

第一版只使用少量类别：

~~~text
关于你
长期关注
人物
偏好
~~~

例如：

~~~text
长期关注

你正在开发 Fanto，一个强调长期记忆的个人 AI 产品。
来源：3 条记录、2 次对话
最近更新：9 月 25 日
~~~

不需要第一版就做知识图谱。

### 5.3 Memory Item

用户可见 Memory 至少需要：

~~~text
Memory
- 内容
- 类型
- 来源
- 最近更新时间
- 状态
~~~

第一版支持：

- 查看；
- 修改；
- 删除。

未来再考虑固定、暂时忘记、合并、历史版本等能力。

### 5.4 来源可解释

Memory 最重要的不只是可删除，还要回答：

> **你为什么会这么认为？**

因此 Memory 应保留来源引用：

- Record；
- Conversation；
- 用户显式设置；
- Data Source；
- 后续 Creation。

来源不必默认全部展开，但应该可追溯。

---

## 6. 当前 Memory Index 与用户可见 Memory 不是一回事

当前 Memory 主要承担：

~~~text
Record
  ↓
atomic chunks
  ↓
embedding / pgvector
  ↓
retrieval
~~~

它是检索能力，不是可以直接展示和编辑的长期 Memory 实体。

正式实现“可见记忆”时，应增加稳定、可编辑、带来源的 Memory Item：

~~~text
原始事实                    长期理解                 检索基础设施

Record ---------\
Conversation -----> Memory Item -------> Agent Context
Data Source -----/       |
                         +------------> Retrieval Index
~~~

用户编辑的是“Fanto 对我的长期理解”，而不是 vector item、embedding 或一次检索出来的 snippet。

---

## 7. 三个能力最终如何形成闭环

一个未来的典型场景：

1. 用户授权 Calendar 和 Health；
2. Fanto 知道明早连续有三个会议、最近两晚睡眠较少；
3. Fanto 已有长期记忆：“用户不喜欢早晨安排高强度运动”；
4. 用户创建任务：“每天晚上帮我简单看一下第二天的安排，有必要再提醒我”；
5. 晚间 Task 触发，结合 Calendar + Health + Memory；
6. 只有确实有价值时才通知用户；
7. 用户可在任务页回看这次执行结果。

链路：

~~~text
Schedule
   ↓
Task Run
   ↓
Current Context + Memory
   ↓
Fanto
   ↓
有价值才通知用户
~~~

这时“数据、记忆、主动任务”才真正形成产品闭环。

---

## 8. 建议迭代顺序

### Iteration A：任务显化

目标：

> 用户第一次能明确看到“Fanto 正在替我持续做什么”。

范围：

- Chat / Task 双 Tab；
- 时间型 Product Task；
- Task 状态；
- TaskRun 历史；
- 任务详情；
- 暂停 / 恢复 / 修改 / 删除；
- Conversation 创建任务。

这是最容易先形成完整产品闭环的一步。

### Iteration B：可见记忆

目标：

> 用户第一次能明确看到“Fanto 认为它记住了我什么”。

范围：

- Memory Item；
- 来源；
- 查看；
- 编辑；
- 删除；
- Agent Context 使用 Memory Item。

暂时不做复杂 Memory Graph。

### Iteration C：数据源

目标：

> 在用户授权下，把 Fanto 的上下文从“用户告诉我的”扩展到“用户允许我知道的”。

首批建议：

1. Calendar；
2. Reminders / Todo；
3. Health：Sleep / Activity / Workout；
4. 用户主动选择的 Files。

后续再考虑 App Usage、Notes、Mail 和第三方 Connector。

---

## 9. 需要后续单独设计的问题

### Task

- Task 与 Notification 的关系；
- 无结果的任务是否产生 TaskRun；
- 条件任务的数据模型；
- 一个任务是否绑定独立 Agent Session；
- TaskRun 的结果是否自动形成长期记忆。

### Data Source

- 各数据源实时查询还是同步到 Server；
- 哪些原始数据允许服务端持久化；
- 用户关闭数据源后历史数据如何处理；
- 多设备授权状态；
- App Usage 和 Notes 在 iOS 上的最终可行范围。

### Memory

- 自动生成 Memory 的触发方式；
- Memory 类型体系；
- Record / Conversation / Data Source 如何共同产生 Memory；
- Memory 修改后如何与原始来源保持关系；
- Preference 最终成为 Memory 的一种类型，还是继续保留独立 Domain。

---

## 10. 成功标准

不以“接了多少数据源”衡量，而看三个问题：

### 任务

用户是否清楚知道：

> **Fanto 现在在替我做什么？**

### 数据

用户是否清楚知道：

> **Fanto 可以看到我的哪些数据？**

### 记忆

用户是否清楚知道：

> **Fanto 记住了我什么，而且我能纠正它。**

如果这三个问题都能在产品里直接得到答案，Fanto 才开始从一个聊天 Agent 变成真正可长期信任的个人智能。
