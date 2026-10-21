# Server Agent Guide

适用于 `apps/server/`。先阅读 [Server](../../docs/architecture/server.md)、[Agent](../../docs/architecture/agent-runtime.md) 和 [HTTP API](../../docs/api/http-api.md)。

## 目录职责

- `src/bootstrap/`：服务装配、配置、启动、迁移。
- `src/routes/`：HTTP 参数、用户认证边界与响应；包括统一 `routes/agent/`。
- `src/domain/`：Records、Media、Memory、Fanto、Users（个人资料）。
- `src/agent/`：唯一 Pi Harness、SessionManager、Tool、Context、Prompt 与 Skill。
- `src/event/`：非持久化的 Record Postprocess 与 Embedding 队列。
- `src/listeners/`：Record 后置理解和 Embedding 消费者。
- `src/infrastructure/`：PostgreSQL、OSS、外部 AI Client、日志和缓存。
- `src/migrations/`：当前重置基线与后续有序前向迁移。

## 边界与不变量

- HTTP Route 不直接访问 Repository；领域操作走 Service。Agent Tool / Context Provider 只能通过 `agent/business-services.ts` 调用获准领域服务，不调用内部 HTTP。
- 所有数据读取、写入和查询必须 user-scoped，身份只能来自已校验 JWT / Session；模型与请求参数不能替换用户身份。
- 停止使用通用 Session stop：先标记停止，已开始工具自然完成，不把用户停止信号传入工具内部；禁止后续模型请求与新工具。200 表示已收尾，202/stopping 表示仍在结束当前操作，终态才可续发。SDK Session 与 frame drain 在内存运行；稳定历史异步尽力保存，正常结束/停止不等数据库。断线仅分离 SSE，History 优先恢复内存。Record 正式写入继续保持事务。唯一对话契约、快照/冷恢复/容量边界见 [Agent Runtime](../../docs/architecture/agent-runtime.md)。
- 迁移顺序固定为三位数字 + 英文 snake_case 简介：`NNN_description.ts`，不可随意重命名已经发布的迁移。`001_create_current_schema.ts` 固化旧库基线；`002_fanto_scoped_memory.ts` 增量升级当前角色记忆及 Session 约束。迁移记录兼容以前未编号的 `create_current_schema_20261019`。旧会话不重绑、旧记忆只归档、应用不自动清库；正常部署前先备份、停止旧版本写入，迁移成功后再启动新服务。
- 登录身份的 contact_value 保存 Provider 验证结果中的完整邮箱或国际格式手机号；缺失返回不清空旧值，不从脱敏提示反推，不按邮箱合并身份。接口继续仅返回 displayHint；手机号实际短信 Provider 尚未接入。具体契约见 [Users](../../docs/domain/users.md#认证)。
- 用户统计由 UserProfileService 按 JWT userId 读取注册时间与全部现存 Record 数，相伴日按请求时区计算（默认UTC），亲密度暂固定12并标记为占位；不新增统计表。用户个人资料由 UserProfileService 管理 `user_profiles`，与角色设置分开。Profile PATCH 校验版本，头像只能为本人 ready 的 user_avatar，背景图只能为本人 ready 的 user_cover；nickname / signature 不自动注入角色 Prompt。见 [Users](../../docs/domain/users.md)。
- FantoService 管理 user_fantos：每用户最多 3 active，nickname 必填不可重复，身份字段创建后固定；PATCH 仅改 agent_config/头像。active/archived 可恢复切换，物理删除不保留 deleted 标记。main Session 以 user_id/agent_id/scope_key 唯一，scope_key 均为 fantoId；默认角色注册事务创建，所有角色绑定固定 Session，默认 Session 幂等初始化，禁止通用创建/重绑定。用户行锁内校验并预留 Run；运行中 PATCH/归档/删除返回 FANTO_BUSY。当前仅单进程运行门禁，多实例需分布式租约。
- 删除角色先排空并驱逐 Session Checkpoint，再显式删除角色 Owner 数据、会话子表与独占媒体；User 数据和其他角色保留。对象 key 持久化到 fanto_media_deletions，提交后删除对象；失败返回 202，重复 DELETE 重试，全部清理才返回 204。不能以数据库行删除成功冒充外部对象清理完成。无 FK 不代表裸删 users 会级联，当前没有账户物理删除 API。
- Memory 仅按 fantoId 隔离，既无 User Memory 也无 kind。main 静态三工具 record_read/fanto_memory_manage/present_media；fantoMemoryEnabled 控制记忆工具、第一人称指导与上下文读取，默认 true。默认 fanto 不可更改 agentConfig、归档或删除，包含在 3 个名额内。MainDynamicProvider 不自动注入 recent_records；角色记忆上下文预算 12000 字节。详见 Fanto/Memory/Agent Runtime 文档。
- Current docs 描述已实现语义；`plan/` 只作为方案历史，不作为现状依据。密钥、URL Token 和内部 Tool 参数不得写入面向用户的回复、日志或文档。


## 验证

```bash
pnpm --filter @fanto/server typecheck
pnpm --filter @fanto/server test
```

涉及 PostgreSQL 需隔离 `TEST_DATABASE_URL`；涉及 OSS/模型时区分 Mock 测试和真实收费 smoke。更多测试矩阵见 [测试](../../docs/engineering/testing.md)。

- 媒体业务依赖 `ObjectStorage`，启动按 `OBJECT_STORAGE_PROVIDER` 装配阿里云 OSS / Cloudflare R2，存储 Client 只操作指定 key，不接收图片 variant。Record 图片在服务端生成并存储 WebP 小图后才标记 ready；Fanto / 用户头像与背景图只保存客户端裁切的单张图片，不生成第二份。上传与重试语义见 [Media](../../docs/domain/media.md)。
