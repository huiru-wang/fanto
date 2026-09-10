# Agent API

Agent session 的隔离标识是服务端生成的 UUID `sessionId`。请求仍须带 `x-user-id`；服务端以会话 metadata 校验该用户是否拥有该 sessionId。

## `POST /api/agent/stream`

```json
{"sessionId":"550e8400-e29b-41d4-a716-446655440000","message":"列出工作区文件"}
```

以 SSE 返回 `run_start`、持久化的 `entry` 和最终 `done` 事件。Agent 使用该 sessionId 对应的独立工作区，工具调用与消息均写入 Pi SessionStorage。

Agent 可使用 `search_records` 检索当前用户的 `type=record` 向量记忆，再以 `get_records` 查询原始完整 Record。后者不依赖向量数据，媒体通过原始 Record 中的 `mediaId` 溯源。

## `GET /api/agent/sessions/:sessionId/messages`

查询参数：`cursor` 为排他 sequence 游标，默认 `0`；`limit` 为 1–100，默认 50。

返回持久 Session 中按 sequence 升序排列的原始 entry。工具参数与结果保留原始语义，但响应会移除密钥、令牌、密码和 Authorization 字段。
