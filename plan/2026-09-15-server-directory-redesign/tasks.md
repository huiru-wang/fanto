# Server 目录重构任务

1. [x] 固化运行态清单：区分当前挂载的 Route、listener 与未挂载 Agent 代码。
2. [x] 新建 `bootstrap/`、`infrastructure/` 和目标业务域目录；迁移入口与公共技术适配器。
3. [x] 合并 Record 文件：将实体、内容校验、游标、Repository 接口和 SQLite 实现迁入 `domain/records/`。
4. [x] 合并媒体文件：迁移媒体 Repository、音频转写 operation 到 `domain/media/`；将 OSS、音频转写、图像理解和 Embedding 的对外 SDK 适配迁入 `infrastructure/clients/`。
5. [x] 合并 Creation/Proposal 文件：将读查询、确认事务和关联规则归入 `domain/creations/`。
6. [x] 迁移向量索引 operation 和两个 listener 到 `domain/memory/`、`listeners/`，保持队列行为不变。
7. [x] 将 Route 改为只依赖同域 Domain/Repository 与 `routes/request-user`，删除无意义中转层。
8. [x] 删除未挂载的 Agent、Task、旧 proactive workflow；当前 TypeScript 编译与测试不再需要专门排除它们。
9. [x] 更新所有导入、测试路径、部署启动入口和脚本路径。
10. [x] 运行类型检查、服务端测试、迁移验证及 Record/Creation/Proposal HTTP 回归测试。
11. [x] 更新架构文档、HTTP 文档与 AGENTS.md，明确目录职责与 legacy 边界。
