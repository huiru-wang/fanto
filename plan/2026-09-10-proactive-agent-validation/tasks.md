# 主动 Agent 第五阶段验证：实施任务

## 前置约束

- 只使用合成 fixture；禁止读取或写入真实用户数据库、现有 Agent session、`topics` 或 `creations`。
- 每次运行生成新 runId；既有 run 只读，不提供覆盖模式。
- 不改现有 Contemplate 工作流、HTTP 接口或 migrations。
- Image provider 未配置时，显式记录不可用，不得伪造图像产物。

## 任务清单

1. 建立 `experiments/proactive-agent/fixtures`，编写 20 条固定 ID、按五批时间流排列的合成 Record，以及不传入模型的 oracle 文件。
   - 验收：fixture schema 校验通过；每批 4 条；覆盖文本、图像描述、音频转写、无关记录、反例及长期线索。

2. 在 `apps/server/src/experiments/proactive-agent/` 定义 fixture、Thread、decision、trace、artifact、review 的 TypeBox/Zod schema 与纯函数 validator。
   - 验收：无网络、无数据库依赖的单元测试覆盖无效 ID、重复来源、越预算、跨目录 artifact、错误 Thread 更新和错误 Possibility。

3. 实现隔离的 fixture memory adapter，提供稳定的 `searchRecords` 与 `getRecords`，并记录每次查询及返回的 Record ID。
   - 验收：相同 fixture/query/limit 每次返回顺序相同；只能读取当前实验用户的 Record。

4. 编写版本化 Wake-up、Thread、Moment、Possibility、Quality Gate prompts，并让 Wake-up 严格返回单一 JSON 决策。
   - 验收：prompt 文件有版本号；模型原始输出、解析结果和诊断均保存在 run 目录；解析失败不重试。

5. 构建实验 runner：按五批顺序组装有限上下文、执行决策、强制 8/3/1/1 预算、写入 batch input/trace/结果文件。
   - 验收：目标 run 已存在时失败；任一批失败不覆盖已有 trace；可通过固定 seed 和相同 fixture 复跑产生同结构输出。

6. 实现 Thread Worker 和其业务校验：新建/更新/休眠，输出可比较的前后版本及 diff。
   - 验收：active Thread 需要两条跨时间证据；更新必须使用本批新增 Record；无新增信息的同义 Thread 被拒绝或 silent。

7. 实现 Moment Worker 与文本产物落盘；接入可选 Image adapter，并对未配置 provider 返回 `capability_unavailable`。
   - 验收：Moment 只引用一条源 Record；无图像 provider 时不会产生虚假图片路径；产物可在 review 页面预览。

8. 实现 Specialist adapter contract 和受限 Coding/Research adapters。Coding 只可写入当前 run 的 `outputs/html`，Research 只基于已取回 Record 生成 evidence report。
   - 验收：所有 artifact 通过真实文件存在性与 run 根目录边界校验；Possibility 若无 artifact 必须被 Quality Gate 拒绝。

9. 实现 Quality Gate、失败分类与 action 去重，持久化所有诊断和耗时。
   - 验收：每个 batch 最终状态只能为 `present`、`silent` 或 `failed`；失败原因可由 `trace.json` 单独定位。

10. 编写静态只读 review 小页面和 `review.json` 表单，按时间线展示结果，并把 oracle 延后展开。
    - 验收：能浏览某个 run 的五批完整上下文、Thread diff、可打开 artifact 和人工评分；页面没有重跑或修改实验输入的能力。

11. 使用真实配置跑完整个合成 fixture 至少一次，完成一份人工 review，并针对最高影响失败点只改一个变量后做一次对照运行。
    - 验收：两次 run 均保留；对照结论可追溯到 fixture、prompt 版本、trace 和评分，而不是主观截图。

## 推荐实施顺序

先完成 1–3 与 9 的确定性基础，再完成 4–6 的决策与 Thread 验证；随后引入 7–8 的产物能力；最后完成 10–11。这样即使 specialist 尚未可用，也能先回答「何时应该保持沉默」和「Thread 是否会自然生长」。
