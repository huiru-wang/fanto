# Memory 重设计任务（代码已实现，模型验收有未通过项）

方案：[详细设计](./2026-10-17-memory-redesign.md)。Current State 以 docs/domain/memory.md 和代码为准。

1. [x] 四类语义与 Agent 的读取、新增、补充、纠错、递进、完成规则。
2. [x] 新 kind 和数据库约束扩展；旧数据不转换、不删除，新链路只操作新类型。
3. [x] 默认注入个人背景与相处偏好，按字节预算整条选择，声明省略与读取失败。
4. [x] 更新 fantoCore、mainPrompt、memory_manage；Agent 决定按话题检索和读写，移除旧冲突规则。
5. [ ] 行为验收尚未全部通过：类型检查和仓库回归通过；隔离 PostgreSQL 的 Memory 集成与迁移基线通过（2 项）。真实 deepseek-v4-flash 独立 12 场景中 11 项通过，普通自我介绍自动写入失败；请求 payload 已确认包含新政策。关系/关注/偏好新增、纠错、递进、完成、重复不写、临时状态不写、小说不写、主动检索与背景免检索通过。不能把 Prompt 注入成功报告为模型稳定遵循。
6. [x] 更新 Memory、Agent Runtime、产品范围、Server AGENTS 与测试文档；没有后台整理、自动遗忘、过期或首次交互。
