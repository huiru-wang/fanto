# User Preferences

User Preference 表示用户**明确表达并希望未来继续适用**的长期偏好。它与 Record / Memory 分开存储：Record 是用户经历、事实和原始表达，Preference 是用户明确要求 Fanto 长期遵循的交流或生活偏好。

## 数据模型

Business Server 使用 user_preferences 保存：

~~~text
id                    integer，自增数据库主键
preference_id         UUID，对 API / Agent Tool 暴露的业务 ID
user_id               用户归属
category              communication | scenario | lifestyle
content               偏好正文和必要适用条件
source_session_id     最近一次明确来源 Session
source_message_id     最近一次来源用户消息的 Pi entry id
source_quote          当前用户消息中的连续直接原话
version               乐观并发版本
created_at/updated_at Server UTC 时间
~~~

每个用户最多 20 条 Preference。创建完全相同的 category + content 时复用原条目，并刷新最近来源和版本；更新、删除都要求当前 version。

Preference 不是模型推断画像。临时要求、普通事实、Record 内容、第三方转述、角色扮演文本和模型推测都不应写入。

## 写入链路

Preference 是否需要创建、更新或删除由 Fanto 主模型在正常 Agent Loop 中判断，不存在独立 Preference 抽取模型或后台扫描：

~~~mermaid
sequenceDiagram
  participant U as User
  participant A as Fanto Agent
  participant T as preference_manage
  participant S as Business Server
  participant DB as user_preferences

  U->>A: 明确长期偏好 / 管理请求
  A->>T: create | update | delete
  T->>S: user-scoped HTTP
  S->>DB: optimistic mutation
  DB-->>S: latest state
  S-->>T: mutation result
  T->>S: GET /api/preferences
  S-->>T: refreshed list
  T-->>A: refreshed preferences
~~~

Tool schema 不允许模型填写 userId、sessionId 或 messageId。这些字段从当前 Session / Run Context 获取；sourceQuote 必须是当前用户消息中的连续原文，否则 Tool 拒绝写入。

Preference Tool 成功后不会重新构建本轮 System Prompt。Tool Result 会返回最新 Preference 列表供当前 Agent Loop 继续使用；下一次 Agent Run 的 PreferenceProvider 会自然读取新状态。

## 读取与 Context Runtime

每次 Fanto Agent Run 开始前，PreferenceProvider 调用 GET /api/preferences。Server 最多返回当前用户 20 条，按最近更新时间排序。Context Runtime 将其注入 user_preferences 插槽，并包含 preferenceId / version / category / content，使模型在用户后续明确修改或删除时可以直接调用 preference_manage。

用户当前消息优先级始终高于已保存 Preference。

## 用户隔离与日志

所有 Repository 读写都显式包含 user_id。更新和删除同时校验：

~~~text
user_id + preference_id + version
~~~

Preference 的 content、sourceQuote / source.quote 在 Business Server access log 中会被脱敏；Agent SSE 也不会公开 Tool 参数或 Preference Tool Result。

## Schema 策略

Preference 表属于当前业务 schema。仓库仍只维护 create_current_schema.ts 这一份面向空数据库的当前 schema 基线，不提供旧 SQLite 数据库的原地升级链。
