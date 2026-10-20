# Fanto 多角色

Server 支持一个用户拥有多个 Fanto，最多 3 个 active（应用常量 `MAX_ACTIVE_FANTOS`），归档不占名额。H5 已接入多角色与能力配置，见 [H5](../clients/h5.md)；iOS 尚未适配本轮服务端契约，旧客户端的身份编辑和会话重绑定写入已禁用。

## 数据与创建

`user_fantos` 以 `fanto_id UUID` 为主键，`user_id` 为非唯一归属。所有业务表均无 SQL 外键，归属、引用和清理由 Service 显式验证。字段包含 nickname、description、avatar_media_id、role_config、agent_config、status、archived_at、version 与时间；没有 session_id、deleted 或 deleted_at。

`POST /api/fanto` 在用户行锁事务内检查活跃名额，创建角色及固定 Session。nickname、description 和 roleConfig 四项（character、scenario、instructions、exampleDialogues）可省略、为 null 或空字符串，统一存为空字符串；创建后身份固定。空 Prompt 段落整体省略，无默认虚构人格。description 仅用于列表展示。

`PATCH /api/fanto` 仅允许 agentConfig 和 avatarMediaId，校验 expectedVersion，递增 version。agentConfig 子键合并，未知键拒绝。身份字段、status 和 sessionId 不可通过 PATCH 修改。头像必须是本人 ready、未退役或清理认领的 fanto_avatar。

## Agent 配置

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| recordReadEnabled | false | 读取 User Records 及其媒体 |
| userMemoryEnabled | false | 仅读取 User Memory |
| narrationEnabled | false | 允许角色动作与旁白 |

角色始终可使用 present_media 和 fanto_memory_manage；present_media 仍受 Record 授权、媒体来源及账号归属校验。开启 User Memory 不赋予写权限。默认 Main 独立于角色，静态工具为 record_read、user_memory_manage、present_media。

## 固定 Session

`agent_session.sessions` 的 `(user_id,agent_id,scope_key)` 对 main 唯一。scope_key 为 `default` 或 fantoId；agent_id 始终是 main。角色创建时初始化 Session；`GET /api/agent/main-session` 首次幂等初始化默认 Main，之后复用。角色响应提供 sessionId，但 user_fantos 不重复持久化指针。

通用 `POST /api/agent/sessions` 返回 403。切换角色只切换既有 Session，归档/恢复不更换 Session，也不合并默认 Main 的历史。旧 `/api/character PUT` 返回 409；旧设置写入入口不再开放。

## 生命周期、并发和删除

归档切换 active → archived 并写 archived_at；恢复反向切换并重新检查名额。归档保留记忆、Session 和头像，禁止新 Run；History/Stop 仍按 Session 所有权读取或操作。

创建、恢复、PATCH、归档、删除和 Run 预留在同一用户行锁上串行化。SessionManager 在该锁内校验角色状态并预留运行；运行中 PATCH/归档/删除返回 409 FANTO_BUSY，使同一 Run 的 Prompt、Tool 和权限读取保持一致。运行状态门禁依赖单个服务进程；多实例部署前必须增加分布式运行租约。

物理删除先检查所有权、version 和运行状态，关闭并排空 Checkpoint，事务中显式删除 Session entries/usage/sessions、该 Fanto owner 的 Records/Memories、独占媒体元数据和角色行。保留 User Records/User Memory、其他角色及 default Main。晚到 Checkpoint 因父 Session 不存在而失败，不能重建数据。

独占头像和角色记录媒体的对象 key 同事务写入独立的 `fanto_media_deletions` 清理清单；共享头像保留。提交后尝试删除对象：成功返回 204，存储暂不可用返回 202 `{fantoId,deletionState:'pending'}`。同一用户以相同 fantoId 重试 DELETE 可推进清理，不需要墓碑角色；pending 重试不再比较已不存在角色的版本。其他用户统一 404。全部清理后再次 DELETE 返回 404。没有后台定时重试。

数据库事务失败时角色及业务数据回滚；外部对象操作仅发生在提交后。清理清单不是角色软删除标记。直接在数据库删除 users 不会触发级联；当前没有账户物理删除 API，不应通过裸 SQL 删除用户来维护业务生命周期。

## 头像和迁移

头像上传继续使用 purpose=fanto_avatar，128–512 方形静态图片、最大 512 KiB，original/thumbnail 读取同一对象。替换后未引用的旧头像可使用 `src/bootstrap/cleanup-fanto-avatars.ts` 按既有认领规则清理，默认 dry-run，超过 24 小时才处理；当前角色和用户资料引用均受保护。

当前基线用于新空库，不自动升级旧字段或清空数据。迁移目录仅保留 `create_current_schema_20261019.ts` 一个脚本，包含最终结构；操作者准备空库时需同时清除旧 Kysely 元数据，之后执行 `pnpm db:migrate`。本轮开发只在隔离测试库运行迁移。见 [迁移](../engineering/local-development.md#database-migration) 和 [HTTP](../api/http-api.md#fanto-设置)。
