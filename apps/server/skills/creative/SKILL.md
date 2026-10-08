---
name: creative
description: 为 Fanto 的创意 Proposal 识别与已确认创作执行提供统一指导；proposal-agent 用于识别适合的创意方向，creator-agent 用于按已确认目标执行对应创意模板。
---

# Creative

## Proposal 阶段

proposal-agent 使用本 Skill 时：

1. 完整读取触发 Record。
2. 判断是否存在可执行图片与明确创作价值。
3. 从 visual、cultural、occasion、temporal、story signals 中识别素材特征。
4. 推导适合的创意方向。
5. 内部比较少量候选，只选择一个最佳方向。
6. 调用 skill_read 读取对应 reference。
7. 只有 reference 明确允许时才检索历史 Record，最多 2 次。
8. 检查已有 Project 是否属于同一经历/主题，决定 create 或 extend。
9. 创建 Proposal；无明显价值时返回 no_proposal。

Proposal 文案：
- title：作品标题感，有画面，不写“生成/制作/创作一个”等任务式标题。
- reason：只作为内部判断依据，指出真实细节和创意契合点。
- tags：2–4 个作品化短词，以 2–6 个中文字符为主；优先“作品形态 / 主题世界 / 情绪记忆”，遵循对应 reference 的 Tag Guidance。
- idea：最多 2 句话；第一句说最终作品，第二句说最重要的保留与转化。
- plan：固定 3 项，格式“短标题｜一句结果说明”；只写用户能看到的结果，不写 Agent 操作。
- goal：只写 objective/context/constraints/successCriteria。为 UI 提供稳定的“保留 / 转化”摘要时，constraints 前两项使用“保留：...”和“转化：...”，其余约束随后追加。
- proposedSummary：create 时描述项目事实、主题、成果和延续边界。

Tag 原则：
- Tag 不是“这个创作会怎么做”，而是“这件作品可以叫什么”。
- 不写比例、张数、人物保真、保留原貌、模型、Prompt、高清、精美、高级感等规格或泛化营销词。
- 不机械重复 title，少量参考词用于确定语气，不做固定枚举。

## Creator 阶段

creator-agent 使用本 Skill 时：

1. 从 creation_context 读取唯一可信的 projectId，并调用 project_read 读取最新 Project.goal、content 和版本。
2. 根据当前 goal.objective/context/constraints/successCriteria 判断最匹配的 reference，需要时通过 skill_read 读取。
3. 根据目标读取有关 Record 和参考媒体；可以向 image_generate 传多张参考图，每次返回一张图片，重复调用与否由创作需要决定。
4. 创作不限定固定图片数量、阶段、槽位或执行计划。
5. 项目正文是完整成果，可用 Markdown / html-preview；对文字排版或结构不做图文限定。
6. 最终使用 project_manage(action=update) 更新 Project 的完整 content/goal；保留已确认事实，不编造经历。
7. 用户继续对话时沿用同一 Session，按需读取 Project 当前最新数据、修改并保存。

## References

- references/roleplay.md
- references/art-poster.md
- references/postcard.md
- references/photo-story.md
- references/storybook.md
- references/birthday-memory.md
- references/anniversary.md
- references/then-and-now.md

当前能力边界：
- 最多 3 张源图
- image_generate 每次生成一张图片，可按创作需要多次调用
- 支持 Markdown / html-preview
- 图片模型不负责复杂文字排版
- 事实以当前 Project 和已读 Record 为准
