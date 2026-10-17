# Memory 重设计任务（更新版，待授权实现）

方案：[详细设计](./2026-10-17-memory-redesign.md)。仅更新方案，未修改运行代码。

1. [ ] 固定四类语义与对话评测样例：新增、读取、重复、补充、纠错、递进、完成及不应保存的输入。
2. [ ] 更新 kind 和迁移：保留原 ID/正文，检查旧 profile 中的关系并正确归类；同步数据库约束、领域类型、工具 schema，不新增版本/任务/状态结构。
3. [ ] 修改 MemoryProvider：每轮默认注入 personal_background + interaction_preferences，预算、整条选择和 omitted/unavailable 标识；其他两类按需检索。
4. [ ] 更新 fantoCore、mainPrompt、memory_manage 描述：Agent 决定读写，改前定位原条目，不强制每轮调工具，删除旧政策冲突。
5. [ ] 验证迁移、用户隔离、工具失败、上下文刷新和实际模型行为；测量默认注入及同步 embedding 对响应速度的影响。
6. [ ] 实现后更新 Memory、Agent Runtime、相关模块 AGENTS 与测试文档，只描述最终能力。不实现后台整理、自动遗忘、过期或首次交互。
