# Fanto 多角色执行任务

范围：仅 Server 与对应文档；无提交/推送，无真实数据库重置。

- [x] 1. 恢复本机 AgentDock 执行并检查现有 git diff，保留客户端改动。
- [x] 2. 修复前次测试转义、类型和旧字段 SQL。
- [x] 3. 完成无外键新库基线、Owner、固定 scope_key Session ，并按用户清库后的要求合并为单一基线。
- [x] 4. 完成多角色创建、3 active 上限、固定身份、配置合并、归档/恢复。
- [x] 5. 拆分 User/Fanto Memory、只读用户授权和数据访问守卫。
- [x] 6. 接入动态工具/Schema/Prompt、空段省略与记忆预算，移除 recent_records 运行入口。
- [x] 7. 统一 Run/生命周期门禁、Checkpoint 排空与物理删除、媒体清理持久重试。
- [x] 8. 增补隔离 PG、真实 Pi/faux、HTTP、并发/故障/所有权测试。
- [x] 9. 同步 Fanto/Memory/Records/Agent Runtime/HTTP/迁移/测试文档与服务端 AGENTS。
- [x] 10. 最终 typecheck、全量测试、diff 检查并报告；停止本次隔离数据库实例。

验证结果：Server typecheck 通过；158 tests：156 pass、0 fail、2 skip（真实模型与 R2 smoke）。git diff --check 通过。测试仅使用本轮新建的本机 PostgreSQL 17 + pgvector 隔离实例，已停止。AgentDock 本机命令执行已验证；另一个远程 MCP 入口仍不可用，不影响本地仓库操作。H5/iOS 及原有其他未提交变更保持原状；没有提交、推送或操作实际数据库。
