# Proposal 结果与展示优化方案

## 1. 目标

Proposal 页面从“Agent 解释为什么、准备怎么做”改为“让用户快速理解并愿意接受一个创意”。

页面只回答：

- 要做成什么
- 最终会发生什么变化
- 哪些内容会保留
- 大概分几步完成
- 用户是否想补充自己的想法

不展示 Agent reasoning，不堆技术执行细节。

---

## 2. Proposal 结果契约

ProposalContent 增加 tags：

~~~ts
interface ProposalContent {
  reason: string;
  idea: string;
  plan: string[];
  tags: string[];

  creation?: {
    objective: string;
    context?: string;
    constraints?: string[];
    successCriteria?: string[];
  };
}
~~~

字段职责：

### title

用于“卖最终作品”。

要求：

- 有作品感、画面感
- 优先表达场景 + 创意结果
- 避免“制作一组 / 生成一张 / 创作一个”等任务式标题
- 控制为一眼能读完的长度

示例：

~~~text
假山石洞里的小小身影，画进一页旅行手账
在大观园里，试着走进一次红楼梦
把这一站，留成一张旅行明信片
~~~

### reason

仅作为 Server / Agent 内部判断依据保留。

前端不展示「为什么适合」。

reason 只负责记录：

- 为什么该 Record 值得提议
- 为什么选择这个创意方向
- 历史 Record 为什么有关联

### idea

前端展示名：

~~~text
创作效果
~~~

要求：

- 最多 2 句话
- 第一句：最终会得到什么
- 第二句：最重要的保留 / 转化
- 不描述选图、调用模型、调整参数等执行过程

示例：

~~~text
把这张石洞里的旅行照片画成一页温柔的手绘旅行海报。
保留人物、姿态和原场景，只把摄影质感变成墨线、水彩和温暖纸张。
~~~

### plan

固定 3 项。

每项必须是用户能感知的结果，而不是 Agent 操作步骤。

当前继续使用 string[]，格式统一：

~~~text
标题｜简短说明
~~~

示例：

~~~text
保留这一瞬间｜人物、姿态和原构图保持原样
画成旅行手账｜墨线、透明水彩和自然纸张
完成一页海报｜4:5 竖版，搭配少量旅行文字
~~~

### tags

用于快速建立用户对最终作品的想象。

要求：

- 2–4 个
- 每个以 2–6 个中文字符为主
- 强调作品类型、主题世界、情绪/记忆钩子
- 有作品名、栏目名或产品名的感觉
- 不承担执行说明
- 不使用技术参数、约束词和泛化营销词

推荐组合：

~~~text
作品形态 + 主题世界 + 情绪/记忆钩子
~~~

例如：

~~~text
旅行手绘 / 纸上风景 / 旅途一页
红楼入画 / 古典写真 / 大观园
这一岁 / 成长拾光 / 生日纪念
今昔重逢 / 旧地新章 / 岁月之间
~~~

避免：

~~~text
4:5竖版
人物保真
保留原貌
3张图片
透明水彩
AI生成
高清
精美
高级感
~~~

一句原则：

> Tag 不是“这个创作会怎么做”，而是“这件作品可以叫什么”。

### creation

继续作为用户确认后的执行 Goal。

不用于直接展示技术参数，不增加 intent / skill / imageCount 等执行字段。

---

## 3. Tags 生成逻辑

### proposal-agent system prompt

只定义 tags 是用户展示字段：

- 遵循当前 Skill 的 tags 规则
- 不写 intent、tool、model、execution 参数
- 不定义 Creative 专属词汇

### creative/SKILL.md

统一定义 Creative tags 的语言风格：

- 2–4 个短词
- 优先：作品形态 / 主题世界 / 情绪记忆
- 避免规格、约束、技术词
- 不机械重复 title

### references/*.md

每个创意方向增加精简 Tag Guidance，只给方向和少量参考，不做固定枚举。

| Reference | Tag Guidance |
|---|---|
| roleplay | 文化/作品世界 + 写真作品感；如：红楼入画、古典写真、大观园 |
| art-poster | 手绘作品 + 旅途/场景感；如：旅行手绘、纸上风景、旅途一页 |
| postcard | 地点收藏 + 旅行分享感；如：旅途明信片、城市印象、这一站 |
| photo-story | 片段成章 + 一次经历；如：片段成章、这一日、旅途故事 |
| storybook | 绘本 + 童趣/想象；如：童话绘本、生活入画、小小冒险 |
| birthday-memory | 一岁时间感 + 成长回忆；如：这一岁、成长拾光、岁岁留影 |
| anniversary | 时间跨度 + 纪念感；如：时光回望、一路至今、周年纪念 |
| then-and-now | 时间重逢 + 前后变化；如：今昔重逢、旧地新章、岁月之间 |

### proposal_create schema

结构层只保证：

- minItems = 2
- maxItems = 4
- 单项长度限制
- trim / 去重

不在代码中硬编码审美词表。

---

## 4. Creative Skill 文案要求

shared creative Skill 以及各 reference 的 Proposal 部分统一要求：

- title：作品感
- tags：2–4 个作品化短词，遵循当前 reference 的 Tag Guidance
- idea：最多 2 句话
- plan：固定 3 项
- reason：只供内部判断
- Proposal 重点描述最终效果，不描述执行流程
- 每个方向必须明确“保留什么 / 转化什么”
- 禁止把 model、prompt、sourceMediaIds、imageCount、executionPlan 等内容写入用户文案

不同 reference 负责给出各自的：

- 适用场景
- 最终成果想象
- 保留项
- 转化项
- 3 步 plan 示例
- 精简 Tag Guidance
- creation goal 约束

---

## 5. iOS 页面结构

目标结构：

~~~text
创作提议

标题

[Tag] [Tag] [Tag]

创作效果
一句主描述

保留
人物 · 姿态 · 原场景

转化
墨线 · 水彩 · 艺术纸

创作计划

1  保留这一瞬间
   人物、姿态和原构图保持原样

2  画成旅行手账
   墨线、透明水彩和自然纸张

3  完成一页海报
   4:5 竖版，搭配少量旅行文字

想再改一点？
[ 用户补充创作想法输入框 ]

参考记录 · N 条 >

不感兴趣                创作试试
~~~

---

## 6. UI 信息层级

### 标题

保持当前大标题视觉权重。

标题下面增加 2–4 个高信息密度关键词，例如：

~~~text
[旅行手绘] [纸上风景] [旅途一页]
~~~

或：

~~~text
[红楼入画] [古典写真] [大观园]
~~~

### 创作效果

替换当前「为什么适合 + 创作思路」的大段文字。

展示：

- idea 主文案
- 保留项
- 转化项

优先让用户快速理解“接受后会得到什么”。

### 创作计划

固定 3 项编号步骤。

每项展示：

- 短标题：高权重
- 一句说明：低权重

不使用长段落。

### 用户补充

放在参考记录之前。

标题：

~~~text
想再改一点？
~~~

placeholder：

~~~text
比如：不要文字、想更童话一点、色调更温暖……
~~~

用户输入作为接受 Proposal 时对 creation goal 的补充。

### 参考记录

弱化为单行入口：

~~~text
参考记录 · 1 条 >
~~~

多条时：

~~~text
参考记忆 · 4 条 >
~~~

点击后再展开具体 Record，不在主页面重复展示完整 Record 内容。

### CTA

底部固定：

~~~text
不感兴趣       创作试试
~~~

保持主次按钮层级。

---

## 7. 保留 / 转化

Proposal 页面重点增加两个信息组：

### 保留

表示 AI 不应该改变的核心内容，例如：

- 人物
- 五官
- 年龄感
- 姿态
- 原场景
- 真实时间线

### 转化

表示此次创意会主动改变的内容，例如：

- 红楼梦服饰
- 古典氛围
- 水彩
- 墨线
- 艺术纸
- 明信片版式

tags 已直接进入 ProposalContent。

「保留 / 转化」第一阶段不增加独立字段，iOS 可先根据 idea / creation.constraints 做轻量展示；后续若确实需要结构化，再单独评估，不与 tags 混合。

---

## 8. Server 改动

### proposal-agent / creative Skill

统一文案约束：

- title：作品感
- tags：2–4 个作品化短词
- idea：最多 2 句话
- plan：严格 3 项
- 禁止技术执行文案
- reason 只做内部依据

### API / Schema

ProposalContent 直接增加：

~~~ts
tags: string[]
~~~

proposal_create schema：

- minItems = 2
- maxItems = 4
- 单项长度限制
- trim / 去重

API 直接返回 content.tags。

不增加：

- presentation 包装层
- intent
- skillId
- execution 参数

---

## 9. iOS 改动

Proposal Detail：

- 删除「为什么适合」区块
- 「创作思路」改为「创作效果」
- idea 最多展示 2 句话
- plan 按 `标题｜说明` 拆为 3 个编号步骤
- 直接渲染 content.tags
- 增加「保留 / 转化」视觉区域
- 用户创作想法输入框前置
- 参考记录折叠
- CTA 固定底部

页面目标：

- 首屏能看懂创意是什么
- 3–5 秒内能判断是否想接受
- 页面主要内容可扫读，不依赖长段落阅读

---

## 10. 验收

Server：

1. reason 不再承载用户展示文案
2. idea 不超过 2 句话
3. plan 固定 3 项
4. plan 不出现技术执行步骤
5. tags 固定 2–4 个，符合 Creative Tag 规则
6. shared creative references 均包含精简 Tag Guidance 并遵守结果导向文案规则

iOS：

1. 不显示「为什么适合」
2. 创作效果成为首个核心内容区
3. 页面出现关键词 tags
4. 显示保留 / 转化
5. 计划固定 3 项且可扫读
6. 用户创作想法输入框在参考记录之前
7. 参考记录默认折叠
8. 底部固定「不感兴趣 / 创作试试」
