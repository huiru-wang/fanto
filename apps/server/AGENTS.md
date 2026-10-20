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
- `create_current_schema_20261019.ts` 为唯一重置基线，直接创建当前最终业务结构（含 fanto_id 主键、session_id）及 Agent Checkpoint 三表；不再归并旧迁移历史或自动修复旧结构。表、索引、Schema、vector 扩展均使用 IF NOT EXISTS，保留已存在对象与数据。正常重复执行由 Kysely 历史跳过；删除两张 Kysely 元数据表后可幂等重放当前基线。旧版结构须先由操作者清空业务表、agent_session 表与 Kysely 元数据；IF NOT EXISTS 不等于旧结构升级或校验。禁止应用自动清库。
- 登录身份的 contact_value 保存 Provider 验证结果中的完整邮箱或国际格式手机号；缺失返回不清空旧值，不从脱敏提示反推，不按邮箱合并身份。接口继续仅返回 displayHint；手机号实际短信 Provider 尚未接入。具体契约见 [Users](../../docs/domain/users.md#认证)。
- 用户统计由 UserProfileService 按 JWT userId 读取注册时间与全部现存 Record 数，相伴日按请求时区计算（默认UTC），亲密度暂固定12并标记为占位；不新增统计表。用户个人资料由 UserProfileService 管理 `user_profiles`，与角色设置分开。Profile PATCH 校验版本，头像只能为本人 ready 的 user_avatar，背景图只能为本人 ready 的 user_cover；nickname / signature 不自动注入角色 Prompt。见 [Users](../../docs/domain/users.md)。
- FantoService 统一管理 `user_fanto_settings`：fanto_id 为独立角色主键，user_id 为非唯一归属；当前 API 只操作按创建时间及 ID 排序的首个默认角色，锁定用户确保首次并发保存只创建一行。session_id 只接受本人 main Agent Session，切换会话不改变角色身份，不删除旧会话或记忆。基本资料独立列，角色内容保存在 `role_config` JSONB，PATCH 按 version 校验并合并提交字段；旧 Character API 仅为兼容适配。CharacterProvider 每个 Run 通过 business-services 读取一次，读取失败中止该 Run，保存后下一轮生效。头像必须属于本人且 purpose=fanto_avatar，不能用于 Record；生命周期见 [Fanto](../../docs/domain/fanto.md)。
- Memory 使用个人背景、重要关系、近期关注、相处偏好、共同经历五类；个人背景/相处偏好默认注入，其他由 Main 按需检索或 Provider 在连续性话题上轻量预检索。Main 的 Core/Persona/Memory/Response 约束集中在 `agent/prompts/main.ts`，沿用 memory_manage；不增加逐消息后台整理、记忆版本或语义校验层。存储与历史类型边界见 [Memory](../../docs/domain/memory.md)。
- Current docs 描述已实现语义；`plan/` 只作为方案历史，不作为现状依据。密钥、URL Token 和内部 Tool 参数不得写入面向用户的回复、日志或文档。


## 验证

```bash
pnpm --filter @fanto/server typecheck
pnpm --filter @fanto/server test
```

涉及 PostgreSQL 需隔离 `TEST_DATABASE_URL`；涉及 OSS/模型时区分 Mock 测试和真实收费 smoke。更多测试矩阵见 [测试](../../docs/engineering/testing.md)。

- 媒体业务依赖 `ObjectStorage`，启动按 `OBJECT_STORAGE_PROVIDER` 装配阿里云 OSS / Cloudflare R2，存储 Client 只操作指定 key，不接收图片 variant。Record 图片在服务端生成并存储 WebP 小图后才标记 ready；Fanto / 用户头像与背景图只保存客户端裁切的单张图片，不生成第二份。上传与重试语义见 [Media](../../docs/domain/media.md)。
