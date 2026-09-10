# 执行任务：Record 向量记忆与 Agent Memory

## 数据与基础设施

- [ ] 确认 embedding 服务协议、模型、维度、最大输入长度和归一化规则；启动时校验 sqlite-vec 与配置维度。
- [ ] 新增 `vector_items`、sqlite-vec 表及 Kysely schema；定义 `type=record`、`outerId=recordId`、状态和操作枚举。
- [ ] 实现 embedding client、用户文本与音频 ASR 的固定顺序内容拼装、content hash 和超长内容处理。
- [ ] 实现进程内异步消息消费者的幂等处理和失败日志；不实现 outbox、重试或补偿。

## 消息与索引

- [ ] 在 Record create 成功提交后发布 `upsert` 消息。
- [ ] 在 Record update 成功提交后发布 `replace` 消息，严格保证先更新原始 Record、后发消息。
- [ ] 保存 Record 时直接读取已同步保存的音频 ASR 文本；不实现 ASR 成功或图片理解成功触发的向量消息。
- [ ] 实现 `replace` 消费：删除 `type + outerId` 旧 vector item/embedding，重读 Record，再写入新向量。
- [ ] 实现 `upsert` 消费：以 `type + outerId + contentHash` 去重后存储向量。

## 检索与 Agent

- [ ] 实现向量 KNN 查询及回表过滤：当前用户、`type=record`、`status=indexed`。
- [ ] 实现 `search_records(query, limit)`，每项返回 `recordId`、snippet 和 score。
- [ ] 实现 `get_records(recordIds)`，只查询当前用户的原始 Record，限制最多 20 个 ID。
- [ ] 在 Harness 注册并显式启用 `search_records`、`get_records`，将当前 userId 固化到 tool context。
- [ ] 更新 Agent 系统提示和原始消息 DTO 文档，说明先搜后取与 Record/media 溯源。

## 验证

- [ ] 单测：内容拼装、content hash、upsert 幂等、replace 删除范围、失败仅记录日志及图片不被索引。
- [ ] 集成测：创建和更新两类消息；旧向量不可见、跨用户隔离及 get_records 不访问向量表。
- [ ] 使用独立数据库副本做真实 embedding 验证，不重跑用户数据。
- [ ] 更新 HTTP/Agent 文档和 `AGENTS.md` Memory 约定。
