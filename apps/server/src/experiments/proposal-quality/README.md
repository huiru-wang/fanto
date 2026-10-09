# Proposal / Creator 通用价值评测

`cases.json` 是跨生活、职业、思考、情绪、家庭、关系、学习、创作、决策、金钱和工作场景的合成**产品判断**基准，包含看似相关但无变化、主题差异很大但明确相关、真实的补充与纠正、孤立而无价值的记录。它不参与线上 Prompt，也不被运行时代码引用。

## Replay

1. 在测试环境按 case 准备对应触发 Record 和可选的已有 Project（Project alias 需转换成该环境的真实 ID）。保留相应的 Project.goal 和当前 content；不允许靠字符串关键词硬编码判断。
2. 运行真正的 Proposal Agent（含上下文检索、Tool、Skill），记录 decision、changeKind、targetProjectAlias 与 sessionId。No Proposal 应有有依据的原因；Create Idea 要可实际交付并具有具体成品预告。
3. 将结果以数组 `[ {"id":"pq-01","decision":"extend","changeKind":"enrich","targetProjectAlias":"project-A"}, ... ]` 保存到 `results.json`；运行 `pnpm exec tsx src/experiments/proposal-quality/evaluate.ts results.json` 得到整体和分领域命中率及失败清单。
4. 抽样将已接受的 Project 交给 Creator 做真实媒体/文本产出，人工评估忠实度、完成度、风格一致性和对原有内容的保留；含图片的案例需检查 image_review 是否调用且真正回看实际图像。

## 评测防拟合

- 不能把案例句子或预期分类写进 System Prompt/Skill/源代码；线上分类完全由模型按价值、关系与内容判断。
- 数据集应继续引入真实且匿名化的失败案例、反例和新领域，定期替换表达方式与用户背景。不要用单一静态集合宣布“创意质量达标”。
- 分类正确不代表文案或作品优秀；Create/Extend 的 `idea`、修改后的 `content` 需另做盲评。
- 不运行 live-agent 回放时，这只是离线测试**工具和用例**，不是模型效果通过证明。

## Isolated live-model probe

With the server environment configured, run `pnpm exec tsx src/experiments/proposal-quality/replay.ts 7 0 5` in `apps/server`: the arguments are `limit`, `start` and `stride` over the synthetic dataset. It runs the production Proposal system prompt and proposal-only skills against a remote model, with mocked read/create tools. It never accesses the user's database or saves actual Proposals. Results go into an untracked `replay-output.json`. These probes test model/tool behavior, not the complete Agent Harness and database pipeline.
