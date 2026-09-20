# Fanto 轻量角色卡实现方案

## 1. 目标

为 Fanto 增加轻量 Character Card 能力，解决当前对话“回答正确但缺少角色感、语气趋同、沉浸感弱”的问题。

角色卡只负责定义：

> **Fanto 是谁、如何表达、如何反应。**

角色卡保持静态，不承担：

- 用户长期记忆
- 用户偏好
- 关系状态
- 当前场景
- 最近发生的事件

这些继续由 Memory / Context Runtime 动态提供。

---

## 2. 核心模型

借鉴 SillyTavern Character Card，但针对 Fanto 大幅简化。

```text
Fanto Core
    +
Character Profile
    +
Dynamic User Context
    +
Relevant Memory
    +
Conversation History
    ↓
LLM
```

其中：

```text
Fanto Core
= 所有 Fanto 共同遵守的核心身份与行为原则

Character Profile
= 不同 Fanto 性格的静态差异

Dynamic Context
= 当前用户、记忆、会话等真实信息
```

---

## 3. Character Card 数据结构

P0 角色卡只保留以下字段：

```yaml
id: natural
name: Fanto

identity: |
  Fanto 是一个长期陪伴用户的 AI 伙伴。
  有自己的表达方式和判断，但不会假装知道不存在的信息。

personality: |
  自然、好奇、聪明、克制。
  不刻意讨好，偶尔有轻微吐槽。

behavior: |
  用户只是在分享时，不强行给建议。
  发现明显矛盾时可以指出。
  可以表达自己的即时反应。
  不为了显得有帮助而强行总结。

speech_style: |
  短句为主。
  偏口语。
  少列点。
  少使用模板式共情。
  避免客服和咨询报告式语气。

first_message: |
  嗨，我是 Fanto。
  想到什么就说什么吧，慢慢认识就行。

examples:
  - user: "今天完全不想干活"
    assistant: |
      又不想干了？
      今天是哪种——单纯累，还是觉得手上的东西没意思？

  - user: "我是不是想太多了"
    assistant: |
      有一点。
      但这个问题也不是凭空冒出来的，先别急着把它归类成内耗。
```

核心字段：

```text
identity
personality
behavior
speech_style
first_message
examples
```

不引入 SillyTavern 中的 `scenario`。

Fanto 的 Scenario 是动态现实环境，不应固化在角色卡。

---

## 4. Fanto Core 与角色 Profile 分离

不同角色不能复制完整 System Prompt。

统一维护：

```text
Fanto Core
├── 核心身份
├── 真实性约束
├── Memory 使用原则
├── Tool 使用原则
├── 基础行为边界
└── 通用系统规则
```

角色 Profile 只负责差异：

```text
Character Profile
├── personality
├── behavior
├── speech_style
├── first_message
└── examples
```

结构：

```text
                    Fanto Core
                         │
           ┌─────────────┼─────────────┐
           │             │             │
        Natural        Gentle        Candid
           │             │             │
      Personality   Personality   Personality
      Behavior      Behavior      Behavior
      Style         Style         Style
      Examples      Examples      Examples
```

P0 建议提供：

```text
natural
gentle
candid
lively
```

默认使用 `natural`。

---

## 5. Runtime Context 拼装

每次 Agent 执行前，由 Context Builder 拼装：

```text
1. System Core
   Fanto 公共规则

2. Character Profile
   identity
   personality
   behavior
   speech_style

3. Behavior Examples
   当前角色相关示例

4. User Context
   用户动态信息

5. Relevant Memory
   当前 Query 召回记忆

6. Conversation History

7. Current User Message
```

角色卡本身不能直接访问数据库或 Memory。

它只是 Runtime 的一个静态 Context Source。

---

## 6. Examples 设计

Examples 是 P0 的核心能力，优先级高于继续堆 Personality 描述。

每个官方角色准备约：

```text
20～30 条高质量 Behavior Examples
```

覆盖典型场景：

```text
普通聊天
分享开心的事情
吐槽
低落
犹豫
寻求建议
用户自相矛盾
用户开玩笑
用户只希望被回应
技术/严肃讨论
不知道答案
引用已有记忆
不同意用户
```

Example 重点展示：

> 角色“怎么做”，而不是“是什么性格”。

例如不要只写：

```text
Fanto 很直接。
```

而应提供：

```text
User:
我是不是应该再等等？

Fanto:
你已经说第三次“再等等”了。

如果没有新的信息进来，
继续等其实也只是暂时不做决定。
```

---

## 7. Examples Runtime 策略

P0 可先采用最简单方式：

```text
每个角色维护 20～30 条 Examples
Runtime 固定选 5～8 条高代表性示例
```

避免第一版引入额外复杂度。

后续再升级为：

```text
Current Query
    ↓
Example Retrieval
    ↓
选择最相关的 3～5 条
    ↓
注入 Context
```

Example Retrieval 可基于：

- embedding similarity
- tags
- 场景分类

但不属于 P0 必需项。

---

## 8. 数据存储

角色卡数量少、官方维护为主，P0 不建议立即数据库化。

优先采用代码仓库静态配置：

```text
character/
├── core.yaml
├── natural.yaml
├── gentle.yaml
├── candid.yaml
└── lively.yaml
```

或者：

```text
character/
├── core.md
├── natural/
│   ├── character.yaml
│   └── examples.yaml
├── gentle/
├── candid/
└── lively/
```

推荐第二种，方便后续扩展 Example。

用户只需要存：

```text
user_character_settings

user_id
character_id
```

如果当前用户配置已有通用 settings / preferences 存储，可以直接复用，不必新增表。

---

## 9. Agent 边界

角色定义不再直接写进 `agent.yaml`。

`agent.yaml` 负责：

```text
model
tools
skills
runtime
context strategy
```

Character 独立成为 Context Source：

```text
Agent Runtime
     │
     ├── Character
     ├── Memory
     ├── Conversation
     └── Tools
```

这样未来可以：

- 修改角色而不影响 Agent 配置
- 增加官方角色
- 开放用户自定义角色
- 做角色版本管理
- A/B 测试不同角色表现

---

## 10. P0 产品范围

只实现：

1. Character Core。
2. 3～4 个官方 Character Profile。
3. Character Profile 静态配置。
4. 每个 Profile 20～30 条 Examples。
5. 用户选择当前 Character。
6. Runtime 注入 Character Context。
7. 新用户使用 Character 的 `first_message`。

明确不做：

```text
自定义角色
UGC 角色卡
Lorebook
角色商城
亲密度
Fanto 房间
动态 Personality
动态偏好学习
关系阶段
Example 向量检索
```

---

## 11. 测试方式

准备固定测试集，例如 30～50 个真实用户 Query。

至少覆盖：

```text
闲聊
情绪表达
技术讨论
吐槽
咨询
用户错误判断
用户只是分享
用户要求建议
带 Memory 的问题
多轮对话
```

同一模型、同一 Memory、同一 Context 下比较：

```text
Current Prompt

vs

Natural Character

vs

Gentle Character

vs

Candid Character
```

重点人工 Blind Review：

```text
角色辨识度
自然度
非 AI 感
语言一致性
是否机械共情
是否过度建议
不同角色之间差异是否明显
多轮后是否保持稳定
```

---

## 12. P0 验收标准

满足以下条件即可认为方案有效：

1. 不看角色名称，仅看回答可以明显区分不同 Character。
2. 同一 Character 在不同问题中的语气保持稳定。
3. 相比现有 Prompt，明显减少标准 AI / 客服 / 咨询师式表达。
4. Character 不影响事实正确性和 Memory Grounding。
5. Character 不暴露 Tools、Memory Search 等内部实现。
6. 切换 Character 后，不影响用户历史会话和长期记忆。
7. Character Card 本身不存在用户动态数据。

---

## 13. 核心原则

Character Card 定义：

> **Fanto 如何做人、如何说话、如何反应。**

Memory 定义：

> **真实发生过什么。**

User Context 定义：

> **用户是谁。**

Conversation 定义：

> **现在正在发生什么。**

四者保持严格分离。

第一阶段不要继续追求“一份更完美的超级 System Prompt”，而是验证：

> **Fanto Core + Character Profile + Behavior Examples**

是否能够显著提升角色感、沉浸感和趣味性。