# Fanto 多角色

每个用户最多有 3 个 active Fanto（**含系统默认角色**），归档角色不占名额。每个角色对应唯一固定 Session 与自己的长期记忆。H5 支持多角色，iOS 仍需适配新接口。

## 创建与默认角色

正式注册或首次账户认证创建用户时，注册事务内同步创建默认 Fanto 和 Session。默认角色固定昵称 `fanto`（不可被普通创建接口占用）、空 roleConfig、`recordReadEnabled=true`、`narrationEnabled=false`、`fantoMemoryEnabled=true`。它占 3 个 active 名额之一，不支持更改 roleConfig / agentConfig、归档或删除；头像可独立更新。**不使用 is_default 字段**，业务直接通过保留且不可修改的 `nickname=fanto` 判断默认身份。

`FantoService.defaultSession(userId)` 和角色列表提供幂等补齐入口：锁定 user 行，若没有名为 fanto 的角色则创建；若没有与其绑定的 Session 则创建。已有用户满 3 个 active 且缺失默认角色时返回角色名额错误，不擅自归档或删除。用户昵称在所属账户下大小写不敏感唯一，包含归档角色；创建时 trim 后必须为 1–30 字符；roleConfig 四项允许空值并固化。

Fanto 创建与幂等初始化使用同一个用户行事务锁串行；PostgreSQL 唯一索引同时约束 `(user_id, lower(nickname))`。只有普通 Fanto 可以 PATCH agentConfig，版本冲突拒绝；角色身份与 nickname 创建后固定。头像必须是当前用户 ready 的 fanto_avatar。

## Agent 配置

| 字段 | 新自定义角色默认值 | 系统默认 Fanto |
| --- | --- | --- |
| `recordReadEnabled` | false | true |
| `narrationEnabled` | false | false |
| `fantoMemoryEnabled` | true | true（不可修改） |

开启记忆时激活 `fanto_memory_manage`，注入第一人称长期记忆管理指导及角色自己已存内容；关闭时不开放该工具、不读取/注入记忆，原有记忆保留。永远不存在 User Memory 工具。`present_media` 受对应 Record 来源与权限校验。

## Session 与生命周期

`agent_session.sessions` 以 `(user_id, agent_id='main', scope_key)` 唯一，**所有角色包括默认角色，scope_key 均为 fantoId UUID**，没有 `default` 特殊分支。`GET /api/agent/main-session` 幂等返回默认角色固定 Session。创建普通角色时也初始化固定 Session；`POST /api/agent/sessions` 禁止任意创建。旧 scope_key=default Session **不迁移、不重绑定**，也不会合并历史数据。

普通 Fanto 可归档、恢复或物理删除。变更与 Run 预留使用同一用户行锁，活跃 Run 修改返回 `FANTO_BUSY`。删除前释放会话/checkpoint，事务显式删除 entries/usage/sessions、该 fanto_id 的 Memories/Records 和角色，再排队清理不再使用的媒体；失败可重试。默认 fanto 永远不可归档或删除。仅单进程运行门禁，多实例需分布式租约。

## Schema

`user_fantos` 新建角色要求 nickname 非空且账户内唯一；历史空昵称记录保留，由迁移中的触发器保证新写入规则。`memories` 仅通过 `fanto_id` 归属，取消 kind / User Owner。`001_create_current_schema.ts` 是旧 Schema 历史快照，`002_fanto_scoped_memory.ts` 是增量升级：归档旧记忆、整理角色配置、新 Session 只准绑定 fantoId；**不迁移旧角色对话或记忆内容**。见 [Database Migration](../engineering/local-development.md#database-migration)。
