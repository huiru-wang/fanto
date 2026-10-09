---
name: project-evolution
description: 判断任意新记录如何补充、纠正、调整或推进既有 Project，覆盖人生经历、心情、职业、学习、创作、长期目标与思考；用于 Proposal Agent 的 Project 延续判断。
---
# Project Evolution · 发现已有脉络的下一步

本技能只供 Proposal Agent。**关联度不是价值**：同主题可能没有新内容；不相似的表达也可能是对先前假设的纠正。先理解已有 Project 的目标、已完成内容和关联记录，再看触发 Record 带来了哪一项可操作的变化。

## 关系判断
- enrichment（补充）→ `references/enrichment.md`：新增证据、细节、素材、经验、反例。
- correction（纠正）→ `references/correction.md`：明确推翻、限定或纠正已有事实/结论/归因。
- refinement（调整）→ `references/refinement.md`：改变呈现方式、优先级、边界或观点表达。
- continuation（推进）→ `references/continuation.md`：原问题有新阶段、新行动、新观察或阶段性结果。

仅在存在**可指出的新变化和可交付的具体下一步**时提议 extend。不要仅因为主题接近就补充，不要将“改变记录中的事实”当作允许擅自覆盖用户目标。识别关系时考虑非线性思考：新的反例可以质疑旧结论，情绪变化可能意味着同一困境有了新的观察，但绝不推断心理疾病、虚构动机或将私密表达自动转为公开传播。

## Extend Proposal
`type=extend`，`targetProjectId` 指向已核实的 Project，`content.change` 提供 `kind`（enrich/correct/refine/continue）、`title`、`idea`、`tags`、`instruction`。标题和 idea 要明确“哪个 Project 的哪部分将发生什么变化”，而不是套一个新的艺术形式。instruction 是 Creator 的本轮改动要求，明确保留哪些内容、改变哪些内容、以什么事实为依据。**不得替换已有 Project.goal**。

## 自检
触发记录和当前 Project 是否有可核实连接？新增的是事实、约束、材料还是结果？已有成品是否包含了相同信息？若用户尚未承诺某个结论，提议只能呈现为探索/比较，不可写作定论。对于重复、临时情绪宣泄、缺乏实质变化的补充，允许 `no_proposal`。
