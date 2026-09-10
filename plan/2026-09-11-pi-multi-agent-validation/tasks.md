# Pi 主子 Agent 架构验证：实施任务

## 实施任务

1. 删除前一版直接调用模型的 `src/experiments/proactive/` 脚本及其 package scripts；建立 `src/experiments/pi-proactive/` 和 `experiments/pi-proactive/` 的独立实验目录。
   - 验收：实验入口不再直接调用 `complete()`；不影响现有 Agent API、Contemplate 或数据库代码。

2. 编写 20 条、五批时间流的合成 Record fixture，以及 fixture/Thread/decision/delegation/trace 的 schema。
   - 验收：fixture 不含真实用户内容；所有 ID、批次、日期和引用均能在离线 schema 测试中校验。

3. 实现实验专用 Session repository、run workspace 与 `AgentHarness` factory，主 Harness 和所有子 Harness 共用 model catalogue 但使用不同 session/workspace。
   - 验收：每个 run 只在自己的 `runs/<run-id>/sessions.sqlite` 和目录内写入；runId 冲突失败；关闭所有 Harness 后再返回命令结果。

4. 为主 Harness 实现 fixture memory、Thread/action state、`save_result`、`dismiss` 和三种 delegation tools。
   - 验收：主 Harness 没有 bash、write、image-generation 或网络工具；其所有专业动作都必须出现在 delegation trace 中。

5. 实现 `SpecialistRunner`：每个 delegation 创建独立 Pi child session/Harness，捕获 child entries、工具事件、最终 JSON 和耗时，再关闭 child Harness。
   - 验收：一个 run 中至少可观察到 parent session 与 child session 的不同 ID；child 不拥有 delegation tools，不能递归派生。

6. 实现 Research、Coding、Image 三种 specialist 的 prompt、工具集合、输出 schema 与 workspace 边界。
   - 验收：Research 不联网；Coding 只能在 delegation artifact 根目录写静态网页；Image provider 缺失时返回 `capability_unavailable`，不会生成虚假文件。

7. 实现五批 Wake-up runner、主/子 turn 与 tool 预算、以及 Pi event 到 trace 的采集。
   - 验收：超过主 8 turn、子 6 turn、3 次 memory search 或 1 次 delegation 时停止并记录失败原因；没有自动重跑。

8. 实现 Thread 状态更新与确定性 Quality Gate。
   - 验收：错误 source、重复 action、未跨批次的 Possibility、缺失 artifact、越界路径、过早或无新增证据的 Thread 更新都被拒绝并保留诊断。

9. 实现单一 CLI 命令与结果落盘：生成 manifest、每批 input/main entries/trace/Thread/结果、每次 delegation 的 child entries/结果和 artifacts。
   - 验收：运行后只需阅读 run 目录即可复盘全部主子 Agent 调用，不需要数据库查询、浏览器或额外 UI。

10. 编写离线单元测试：schema、quality gate、artifact 路径限制、主工具权限、子工具权限与 trace 完整性；不在 CI 或自动测试中调用模型。
   - 验收：`pnpm --filter @fanto/server test:pi-proactive` 无网络、无模型密钥即可通过；`typecheck` 通过。

11. 由人工使用 `pnpm --filter @fanto/server experiment:pi-proactive` 运行真实模型，并根据 run 目录完成行为与架构复盘。
   - 验收：人工能确认至少一个独立 child session 的存在、其工具权限与产物；是否通过行为成功标准由人工评分，不由脚本强行判定。

## 推荐顺序

先完成 1–5，先验证主 Agent 确实只能委派；再完成 6–8，让三个 specialist 形成真实受限能力；最后完成 9–11。这样先验证架构，而不是先被 Prompt 质量掩盖架构缺陷。
