# Proposal / Creator 双 Agent 职责与质量体系（2026-10-09）

## 目标
Proposal Agent 优先识别新 Record 对既有 Project 的补充、纠正、调整和推进；只有无法构成有意义的 Project 延续时，才从任意生活、职业、人生思考、学习、心情、关系、文本、图片和语音中发现值得新建的命题。无增量或无价值允许 no_proposal。
Creator Agent 面向用户确认的命题创作与编辑，保留原 Goal、事实依据及既有作品价值，不重新评估 Proposal 是否值得做。

## 专业 Skills（完全隔离）
Proposal 独占：project-evolution（enrich/correct/refine/continue）与 creative-opportunity（visual-art/imagined-world/storytelling/time-echo/insight-synthesis/decision-exploration）。
Creator 独占：art-direction、photography、storytelling、editorial-design、image-creation、creative-review。
旧的 shared creative Skill 删除。AgentDefinition 对两个 Agent 的 Skills 交集进行强制检查；不允许共享 Skill ID。Skills 只负责认知与表达，不承担工具授权。

## P0 链路与数据语义
Processed Record -> Proposal Handler -> creative_context（完整 sourceRecord + Project 候选）-> Project 核查 -> Extend/Create/no_proposal。
Project 候选综合语义、通用词面相似、标题显式提及和最近活跃，不把相似分数当成价值判断。搜索异常时降级词面/最近候选。
Create: type=create + proposedSummary + content.ideas[{title,idea,tags,goal}]。
Extend: type=extend + targetProjectId + content.change{kind,title,idea,tags,instruction}。严格 Zod discriminated union，Extend 不能传新 Goal；接受后保留原 Project.goal。为前端兼容继续公开展示 ideas[] 单候选，并提供 changeKind，不暴露内部 instruction。
Creator 接收本次 Proposal 的实际 change instruction 与关联 Record IDs，调用 record_read 读取，按最新版本合并更新。作品保存与版本校验成功后，且 Worker 释放 Session 前，写入 fanto.proposal_applied 防止错误去重与失败重试。
排队/运行中的 Project 可以接收待确认 Extend 提议，但执行冲突期间仍拒绝接受，避免并发覆盖，等待现有运行结束再接受。

## P1 审美与成果验证
Creator 可按需使用艺术指导、摄影、人像、叙事、编辑排版与生图能力。image_review 支持对实际生成图使用现有视觉模型审查，并可携带真实原图对比。新生成媒体带 requiresReview，未经 image_review 的图片引用不能发布到 Project；审查记录持久化 reviewedAt。模型检查只是视觉观察，并非人工质量保证。
Markdown/受限 html-preview 按现有安全解析及事实/阅读逻辑检查；未提供浏览器截图能力，不虚称像素级视觉审查。
Proposal 决策按 recordId、sessionId、decision 和 proposalId 留结构化日志，no_proposal 的具体原因存在内部 Agent Session。

## 通用性与评测
apps/server/src/experiments/proposal-quality 提供三十余条跨领域 Create/Extend/No Proposal 对照/反例、离线 scorer 与重放说明；不会在运行时做关键词规则匹配。真实模型效果需另外回放，不可把静态样本通过当作模型质量通过。
验证包括 Agent Skill 权限、具体变更流转、Goal 保持、失败重试、实际图片检查、媒体发布门与 H5 类型兼容。需要单独隔离的测试数据库进行 DB 集成测试，不能把当前业务数据库当测试库使用。真实 iOS/模型视觉效果尚须手动验收。
