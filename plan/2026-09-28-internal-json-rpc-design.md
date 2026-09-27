# Fanto 内部 JSON-RPC 设计

> 日期：2026-09-28
> 状态：设计方案，待实施
> 目标：保持 Web 层直接调用 Domain / Repository 的现有结构；将 Agent Runtime 与 Business Server 之间的全部跨项目调用迁移为双向、受限的 JSON-RPC。

## 1. 边界与原则

```text
Web Client ── HTTP / JWT ──> Web Route ──> Domain / Repository

Agent      ── JSON-RPC ──> Server rpc/ ──> Domain / Repository
Server     ── JSON-RPC ──> Agent  rpc/ ──> Task / Agent Runtime
```

- 不新增 Web Adapter 或 Application Service 层；现有 Web Route 保持直接调用所属 Domain / Repository。
- `rpc/` 是专门对其他项目公开的内部能力目录，不复用 `/api/*`、`/api/agent/stream` 或 Web Route。
- Agent Runtime 不直接访问 Business Server 数据库；所有业务读写仍经 Agent 的 `src/clients/server-client.ts`。
- User JWT 只用于 Client → Server / Agent 的 Web 入口；禁止出现在 Run Context、RPC 参数、RPC Header 或服务间日志中。
- 每个 RPC Receiver 使用调用方专用 Token、方法白名单和 `X-User-Id` 三重约束。业务 Handler 只接受已验证的 `userId`，不信任 RPC params 中的用户身份。

## 2. 模块结构

```text
apps/server/src/
├── rpc/
│   ├── protocol.ts
│   ├── auth.ts
│   ├── router.ts
│   ├── records.ts
│   ├── preferences.ts
│   ├── media.ts
│   └── creations.ts
└── clients/
    └── agent-client.ts

apps/agent/src/
├── clients/
│   ├── json-rpc-client.ts
│   ├── server-client.ts
│   └── server-schemas.ts
├── routes/
│   ├── sessions.ts
│   └── stream.ts
└── rpc/
    ├── protocol.ts
    ├── auth.ts
    ├── router.ts
    └── jobs.ts
```

`packages/shared/src/rpc/` 保存双方共用的 JSON-RPC 方法名、params/result DTO 与错误码；不得在两边复制字符串常量或 DTO。

Agent 的面向 Web Client 的 HTTP API 目录统一为 `apps/agent/src/routes/`。现有 `src/http/sessions.ts`、`src/http/stream.ts` 必须迁移至该目录；`app.ts` 只负责装配 Web Route、Web JWT 中间件、RPC Route 与 RPC Token 中间件，不定义业务 HTTP Handler。`routes/` 只服务 Web Client，拒绝内部 Token；`rpc/` 只服务内部项目，拒绝用户 JWT。

## 3. 传输、认证与协议

两个服务各自暴露一个仅供内部项目调用的 `POST /rpc`：

```http
POST /rpc
Content-Type: application/json
X-API-Token: <caller-specific-secret>
X-User-Id: <required-for-user-scoped-methods>
X-Trace-Id: <optional>
```

```json
{
  "jsonrpc": "2.0",
  "id": "4c9fce5f-…",
  "method": "records.list",
  "params": { "limit": 10 }
}
```

第一期仅支持单个、有 `id` 的请求：不支持 batch、notification 或 Web Client 直接访问。HTTP 层仅处理 transport、Token、body size 和 JSON-RPC envelope；合法 RPC 请求始终返回 JSON-RPC response。无效 Token / 缺失用户上下文在 transport 层返回 `401` / `403`，不进入 Method Handler。

### 3.1 双向 Token

| 调用方向 | 发送方配置 | 接收方配置 | 允许用途 |
| --- | --- | --- | --- |
| Agent → Server | `FANTO_SERVER_RPC_TOKEN` | `AGENT_RPC_TOKEN` | Record、Preference、Media、任务结果上传 / 写回 |
| Server → Agent | `FANTO_AGENT_RPC_TOKEN` | `SERVER_RPC_TOKEN` | Server-owned Agent Job 提交、状态读取、取消 |

两组 Token 必须不同、随机生成、仅存在于对应服务的 `.env`。接收方用常量时间比较；每个 `/rpc` 仅接受自己的入站 Token。现有 `AGENT_API_TOKEN` / `FANTO_SERVER_API_TOKEN` 迁移为第一行的 RPC Token 后删除旧 `/api` 内部 Token 分支，避免一个 Web Route 接受两套鉴权。

### 3.2 身份模型

```ts
type RpcPrincipal = {
  caller: "agent" | "server";
  userId: string;
  traceId?: string;
};
```

`X-User-Id` 对所有用户数据方法必填。方法参数不得有 `userId`。接收方在执行前确认用户仍 active；Repository 继续按此 `userId` 做查询 / 写入隔离。

## 4. 方法契约与错误

第一批 Agent → Server 方法：

```text
records.get / records.list / records.search
preferences.list / preferences.create / preferences.update / preferences.delete
media.metadata.get
```

未来 Task Worker 写回结果时新增单一、专用方法：

```text
task-results.put
```

它负责 Server 侧 OSS 写入或签名上传编排，不向 Worker 暴露 OSS 长期凭据。

第一批 Server → Agent 方法：

```text
agent-jobs.submit
agent-jobs.get
agent-jobs.cancel
```

RPC 标准错误：`-32600`（invalid request）、`-32601`（unknown method）、`-32602`（invalid params）；业务错误使用稳定的 `-320xx` 范围，例如 `-32001`（unauthenticated）、`-32003`（forbidden）、`-32004`（not found）、`-32009`（conflict）、`-32050`（internal）。错误 response 不携带 Token、原始异常、用户私密字段或上游完整响应。

## 5. Server 主动调用 Agent：生成脉络

Server 的主动生成脉络属于 **Server-owned Agent Job**，不等同于用户通过 Main Agent 创建的 Task。

```text
Server 业务事件
  → Server 创建 creation_generation_job（业务事实）
  → agent-jobs.submit(requestId, purpose, recordIds, instruction)
  → Agent 创建自身执行记录并返回 accepted / agentJobId
  → task-worker 执行，按需经 records.* RPC 读取数据
  → Agent 经 creations.proposal.put RPC 写回候选结果
  → Server 以 requestId 幂等落库、更新 creation_generation_job
```

Server Job 必须在 Server 数据库记录 `requestId`、`userId`、输入版本 / `recordIds`、状态、Agent Job ID、结果引用和错误摘要；它是生成脉络的业务事实。Agent 仅保存自己的执行状态和 Session，不成为 Creation 的事实来源。

`agent-jobs.submit` 的 params 只传 `requestId`、`purpose`、业务对象 ID 与自包含 instruction；不传完整用户记录或 JWT。Agent 读取业务数据时回调 Server RPC。`requestId` 是提交和写回的幂等键；JSON-RPC `id` 仅用于一次请求关联，不能替代业务幂等键。

第一期 Server Job 可复用 `task-worker` 的独立 Session、工作区、工具白名单和超时控制，但必须以 `origin = server` 区分，不能伪装为 Main Agent 的 `delegate_task` 用户任务。

## 6. 与现有 Task System 的关系

- 用户委托 Task：Agent-owned，Scheduler / WorkerPool 创建和执行 `TaskRun`。
- Server 主动 Job：Server-owned，Server 记录业务 Job；Agent 仅通过 RPC 接收并执行。
- 两者可复用 `task-worker`、`runAgent()`、Session 隔离、WorkerPool 和 `server-client.ts`，但不共享业务状态来源、权限来源或 API 入口。
- Server Job 进入 Agent WorkerPool 时必须与用户 Task 共同计入 `AGENT_TASK_WORKER_CONCURRENCY`，避免绕过单机资源上限。

## 7. 验证标准

1. Web `/api/*` 与 `/api/agent/*` 只接受用户 JWT，内部 Token 不可访问。
2. `/rpc` 只接受对应方向的内部 Token；错误方向 Token、缺失 `X-User-Id` 和非白名单方法被拒绝。
3. `server-client.ts` 的所有方法通过 JSON-RPC，不再请求 Server `/api/*`。
4. RPC params 中伪造 `userId` 不影响实际用户范围；所有用户范围查询仍由 Header Principal 决定。
5. Server 主动 Job 的重复 `requestId` 不创建重复 Agent Job 或重复 Creation Proposal。
6. Server Job 与用户 Task 同时执行时总 Worker 数不超过配置上限。
7. RPC 错误、超时、取消、日志和 traceId 均不泄漏 Token 或用户私密数据。

## 8. 一期不做

- JSON-RPC batch、notification、服务发现、动态方法注册；
- 跨机器队列、重试调度、分布式事务；
- 让任何 Web Client 访问 `/rpc`；
- Agent 直接访问 Server 数据库或 OSS 长期凭据。
