# Agent Runtime

目录：`apps/agent/`。它是独立于 Business Server 的 Hono + Pi `AgentHarness` 服务。

## 组成

```mermaid
flowchart TD
  HTTP[Agent HTTP API] --> REG[Agent Registry]
  HTTP --> SM[Session Manager]
  HTTP --> TR[Task Runner]
  REG --> YAML[agents.yaml]
  SM --> PI[Pi AgentHarness]
  PI --> TOOLS[read / write / edit / bash]
  PI --> SKILLS[Skills]
  SM --> DB[(Agent SQLite)]
  TR --> DB
  SM --> WS[Session Workspace]
```

## Agent Definition

`apps/agent/agents.yaml` 是 Agent 定义来源，只在服务启动时读取。定义包含：

- provider / model；
- systemPrompt；
- tools；
- skills；
- compaction 配置。

当前 Tool schema 只接受：

```text
read
write
edit
bash
```

Skill 通过 ID 映射到 `apps/agent/skills/<id>/SKILL.md`。密钥不写入 YAML。

## Session

调用方必须先通过 `POST /api/agent/sessions` 创建 Session，再用同一 `sessionId` 发起 stream 或 task。

每个 Session 绑定：

- `userId`；
- 当前 `agentId`；
- Agent definition revision；
- 独立 workspace。

绑定信息保存在 Pi Session 的 `fanto.session_owner` custom entry。旧 Session 在下一次执行时可以应用当前 Agent revision；如果调用方指定另一个 Agent，空闲 Session 可以切换 Agent，同时保留历史和工作区。

同一 Session 同时只允许一个运行。

## 执行方式

### Stream

`POST /api/agent/stream` 使用 POST 响应体 SSE，事件为 `start`、`delta`、`done` / `error`。断连会取消执行，单次请求有超时限制。

### Task

`POST /api/agent/tasks` 创建异步任务，任务状态持久化在 Agent SQLite：

```text
pending -> running -> completed | failed
```

当前 Runner 只适合单实例。进程重启后遗留的 running task 会标记失败，不自动重放。

## 历史

Session History 直接读取 Pi Session entry，以 `seq` 倒序分页。内部 `fanto.*` 条目和 compaction 记录不作为普通可见历史返回，敏感字段在对外响应前脱敏。

## Workspace 与安全

文件工具固定工作在 `AGENT_WORKSPACE_ROOT/<sessionId>`。bash 使用该目录作为 cwd、最小环境、超时和危险命令限制。

这些措施不等于宿主机隔离。生产环境如果启用 bash，需要使用无特权容器或微虚拟机，将 Session 工作区作为受控挂载，并限制 CPU、内存、进程与磁盘。

## 与 Fanto 业务数据的当前关系

Agent Runtime 当前不连接 Business Server 数据库，也没有 Record / Creation 业务工具。因此它不能因为“知道 userId”就直接访问用户 Record。

接口和运行示例见 [apps/agent/README.md](../../apps/agent/README.md)。
