# Task H5 产品化与产物预览目标状态

## 目标

在不增加 Task Progress 产品化、不增加 `latestRun` 聚合字段、不改变现有 Bearer JWT 认证模型的前提下，打通完整用户链路：

```text
Main Agent create_task
  -> create_task Tool Result
  -> Agent SSE / Session History 产品化投影
  -> H5 Chat Task Card
  -> H5 Tasks 页面
  -> Task Detail + TaskRun 列表/详情
  -> Task Artifact
  -> Markdown / Text / HTML 域内预览
  -> fanto-media://<mediaId> 媒体解析
  -> OSS 短期 signed URL
```

V1 只要求用户能够明确知道本轮对话创建了什么任务、查看全部任务及执行结果、查看 Run 状态、在 Fanto 域内直接预览 HTML / Markdown / Text 产物，并正确展示产物引用的图片/音频。

明确不在本次范围：

- 不做 Task Progress 文案、阶段、时间线或 Worker Tool Event 产品化；
- 不增加 `latestRun` 到 `/api/tasks`；
- 不暴露 Worker Session / Worker 原始 Agent History；
- 不新增 Artifact 表；
- 不支持完整静态网站目录、JS Bundle、CSS 文件包或任意二进制附件；
- 不修改 H5 为 Cookie Auth；
- 不把 access token 放到 URL；
- 不改 iOS。

---

## 一、统一产品对象

### 1. Task

继续以现有 `tasks` 为任务定义事实来源。

Task 状态保持：

```ts
type TaskStatus = "active" | "paused" | "completed" | "cancelled";
```

含义：

- `active`：任务定义有效，可能等待执行，也可能周期性等待下一次执行；
- `paused`：任务暂停；
- `completed`：一次性任务已结束；
- `cancelled`：任务已取消。

H5 不把 `active` 翻译为“执行中”。

### 2. TaskRun

继续以现有 `task_runs` 表示实际执行实例。

```ts
type TaskRunStatus = "running" | "completed" | "failed" | "cancelled";
```

只有 TaskRun 的 `running` 才表示 Worker 正在执行。

本次不增加额外 progress 字段。

### 3. Artifact

继续使用现有：

```ts
type TaskRunArtifact = {
  filename: string;
  role: "primary" | "supplementary";
  mediaId: string;
  mimeType: string;
  bytes: number;
  checksum: string;
};
```

Task Artifact 仍作为 `media_assets.media_type=file` 保存，不新增 artifact 表。

---

## 二、create_task Tool Result 产品协议

### 1. Tool 原始结果

`create_task` 成功后的 `details` 调整为稳定、可产品化的结构：

```ts
type CreateTaskToolDetails = {
  kind: "task_created";
  task: {
    taskId: string;
    title: string;
    status: "active";
    trigger: TaskTrigger;
    nextRunAt: string;
    output: {
      format: "markdown" | "text" | "html";
    };
  };
};
```

示例：

```json
{
  "kind": "task_created",
  "task": {
    "taskId": "4f...",
    "title": "整理最近一个月的旅行记录",
    "status": "active",
    "trigger": {
      "type": "immediate"
    },
    "nextRunAt": "2026-09-30T02:30:00.000Z",
    "output": {
      "format": "html"
    }
  }
}
```

`TaskService.delegate()` 返回值同步扩展为渲染该结构所需字段，避免 Tool 再次查询 Task。

推荐：

```ts
type DelegateTaskResult = {
  taskId: string;
  title: string;
  status: "active";
  trigger: TaskTrigger;
  nextRunAt: string;
  output: TaskOutput;
};
```

### 2. Tool Result 白名单

Agent SSE 仍不允许任意 Tool Result 透出。

只增加 `create_task` 为产品化白名单：

```text
present_media
create_task
```

新增：

```ts
sanitizeCreateTaskDetails(value): CreateTaskPresentation | undefined
```

SSE 层只允许以下字段：

```ts
type CreateTaskPresentation = {
  kind: "task_created";
  task: {
    taskId: string;
    title: string;
    status: "active";
    trigger: TaskTrigger;
    nextRunAt: string;
    output: TaskOutput;
  };
};
```

不得通过 SSE 返回：

- `goal.context`；
- constraints；
- successCriteria；
- sources；
- userId；
- traceId；
- workerSessionId；
- Tool 参数；
- Tool 内部错误；
- extData。

### 3. AgentStreamEvent

Server：

```ts
type AgentStreamEvent =
  | { type: "turn_start" }
  | { type: "tool_start"; toolCallId: string; toolName: string }
  | {
      type: "tool_end";
      toolCallId: string;
      toolName: string;
      status: "succeeded" | "failed";
      result?: PresentMediaDetails | CreateTaskPresentation;
    }
  | { type: "delta"; text: string };
```

对外仍使用现有 SSE：

```text
event: tool_end
```

成功创建 Task：

```json
{
  "toolCallId": "...",
  "toolName": "create_task",
  "status": "succeeded",
  "result": {
    "kind": "task_created",
    "task": { }
  }
}
```

不新增单独 SSE event name，保持 Agent SSE 协议简单。

---

## 三、Session History 投影

H5 恢复历史对话时同时识别：

```text
present_media Tool Result
create_task Tool Result
```

### 1. AgentHistoryMessage

扩展为：

```ts
type AgentHistoryMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  media: PresentedMedia[];
  tasks: PresentedTask[];
};
```

```ts
type PresentedTask = {
  taskId: string;
  title: string;
  status: "active";
  trigger: TaskTrigger;
  nextRunAt: string;
  output: TaskOutput;
};
```

### 2. 聚合规则

同一 Assistant turn 中：

- Assistant text 聚合为正文；
- `present_media` 聚合到 `media[]`；
- `create_task` 聚合到 `tasks[]`；
- 根据 `taskId` 去重；
- Tool Result 本身不作为单独聊天消息展示；
- 刷新 H5 后 TaskCard 必须能够从 Session History 恢复。

---

## 四、H5 Chat Task Card

### 1. ChatMessage

```ts
type ChatMessage = AgentHistoryMessage & {
  state: MessageState;
};
```

Assistant Message 渲染顺序：

```text
Assistant Markdown Text
Presented Media
Presented Task Cards
Message State
```

### 2. Card 展示内容

每张卡只展示：

```text
状态语义
Task title
Trigger 简述
Output format
查看任务
```

不展示：

- Goal 全文；
- constraints；
- successCriteria；
- agentId；
- taskId 文本；
- Worker 信息；
- Progress。

### 3. 状态语义

TaskCard 不通过额外 Run 请求判断执行状态。

仅根据创建结果表达“任务已建立”：

Immediate：

```text
已创建后台任务
```

Scheduled once：

```text
已安排 · <本地时间>
```

Recurring：

```text
周期任务已创建
```

如果用户进入 Tasks 页面或 Task Detail，再读取真实 Task / TaskRun 状态。

### 4. Card 点击行为

点击 TaskCard：

```text
navigate("/tasks?taskId=<taskId>")
```

Tasks 页面读取 query 参数后自动打开对应 Task Detail Modal。

不为单个 Task 创建独立页面路由。

### 5. 样式

新增：

```text
TaskCard.tsx
```

视觉保持现有 H5 系统：

- 卡片作为 Assistant 内容的一部分；
- 最大宽度约 420px；
- 轻背景、细边框；
- 12~14px 圆角；
- 不使用大面积高饱和状态色；
- 左侧使用轻量 Task / Clock / Check 图标；
- `查看任务` 为弱操作入口。

---

## 五、Tasks 页面

新增：

```text
/apps/h5/src/pages/TasksPage.tsx
/apps/h5/src/api/tasks.ts
/apps/h5/src/components/tasks/TaskListItem.tsx
/apps/h5/src/components/tasks/TaskDetailModal.tsx
/apps/h5/src/components/tasks/TaskArtifactPreview.tsx
```

### 1. 导航

H5 主导航：

```text
记录
Fanto
任务
设置
```

新增路由：

```text
/tasks
```

### 2. Tasks List

数据源：

```http
GET /api/tasks
```

不修改该接口为 latestRun 聚合接口。

列表展示：

- title；
- Task status；
- trigger 摘要；
- nextRunAt（有则展示）；
- output format；
- updatedAt。

状态文案：

```text
active    -> 已启用
paused    -> 已暂停
completed -> 已完成
cancelled -> 已取消
```

对于一次性 immediate Task，`active` 不显示“执行中”。

### 3. Task Detail Modal

打开 Modal 时并行请求：

```http
GET /api/tasks/:taskId
GET /api/tasks/:taskId/runs
```

详情展示：

#### Task 基本信息

- title；
- status；
- objective；
- trigger；
- nextRunAt；
- output format；
- createdAt；
- updatedAt。

`goal.context / constraints / successCriteria` 可以在“任务要求”折叠区展示，不作为列表信息。

`sources.recordIds / sources.mediaIds` V1 不直接展示原始 ID。

#### Task 操作

根据 Task status 显示：

```text
active -> 暂停 / 取消
paused -> 恢复 / 取消
completed -> 无状态操作
cancelled -> 无状态操作
```

使用现有 API：

```http
POST /api/tasks/:taskId/pause
POST /api/tasks/:taskId/resume
DELETE /api/tasks/:taskId
```

操作成功后刷新 Task Detail 与列表。

---

## 六、TaskRun 展示

Task Detail 内展示现有 runs：

```http
GET /api/tasks/:taskId/runs
```

不增加 latestRun。

### 1. Runs 排序

沿用后端倒序：

```text
最新 Run 在最上面
```

### 2. Run 卡片

展示：

- status；
- scheduledAt；
- startedAt；
- finishedAt；
- result.summary（成功时）；
- error 的用户安全文案（失败时）；
- artifacts（成功时）。

不展示：

- workerSessionId；
- traceId；
- Worker History；
- Tool 调用；
- extData；
- 原始内部 error message。

### 3. Running Run

`status=running`：

```text
正在执行
开始时间 <startedAt>
```

V1 不展示任何 Progress 阶段。

Task Detail Modal 打开且存在 `running` Run 时，H5 每 3 秒刷新：

```http
GET /api/tasks/:taskId/runs
```

当不存在 `running` Run 后停止轮询。

页面隐藏 / Modal 关闭时停止轮询。

列表页不轮询 runs。

---

## 七、Artifact 交付协议

### 1. 支持格式

V1 保持：

```text
.html
.md
.txt
```

主产物固定：

```text
html     -> result.html
markdown -> result.md
text     -> result.txt
```

附属 artifact 仍只允许 `.html/.md/.txt`。

不新增目录交付。

### 2. 媒体引用统一协议

Task Worker 生成 HTML / Markdown 时，Fanto 内部媒体只能使用：

```text
fanto-media://<mediaId>
```

Markdown：

```md
![照片](fanto-media://<mediaId>)
```

Markdown 音频链接：

```md
[播放语音](fanto-media://<mediaId>)
```

HTML：

```html
<img src="fanto-media://<mediaId>" alt="...">
```

```html
<audio controls src="fanto-media://<mediaId>"></audio>
```

### 3. 禁止相对媒体文件

禁止：

```html
<img src="images/photo1.jpg">
<img src="./photo1.jpg">
<img src="photo1.jpg">
<audio src="assets/audio.mp3"></audio>
```

原因是 V1 Artifact 模型不存在静态目录与二进制附件映射。

### 4. Task Worker Prompt

`task-worker.ts` 增加明确约束：

```text
HTML / Markdown 中需要引用 Fanto Record 的图片或音频时，必须使用 Record Tool 返回的真实 mediaId，并写为 fanto-media://<mediaId>。

禁止创建或引用 images/*、assets/*、./*.png、./*.jpg、./*.mp3 等相对媒体路径。

不得要求用户下载图片后手工替换 HTML。

如果任务缺少需要的媒体，使用文本占位或在结果中明确说明，不伪造本地文件路径。
```

---

## 八、deliver_task_result 产物校验

`TaskResultPublisher.validateContent()` 增加可预览性校验。

### 1. HTML

保留完整 HTML 起始结构校验，并新增本地媒体引用检查。

拒绝常见本地资源路径：

```text
img[src]
audio[src]
video[src]
source[src]
```

当 URL：

- 非 `fanto-media://`；
- 非允许的 `data:`；
- 非 `http(s)` 外部 URL；
- 且属于相对文件路径；

则拒绝交付。

V1 对外部 `http(s)` 图片可以允许，但不做代理；推荐 Worker 优先使用 Fanto mediaId。

### 2. Markdown

识别 Markdown image / link 中明显的相对二进制资源：

```text
![](images/a.jpg)
![](./a.png)
[](audio/a.mp3)
```

拒绝交付并要求 Worker 改为 `fanto-media://<mediaId>`。

### 3. mediaId 不在 deliver 阶段批量解析

V1 不在 `deliver_task_result` 中解析所有 `fanto-media://` 并写额外关系表。

Preview 时按当前用户边界实时校验 mediaId。

---

## 九、Task Artifact Preview API

新增：

```http
GET /api/tasks/artifacts/:mediaId/preview
```

该接口要求正常：

```http
Authorization: Bearer <access JWT>
```

### 1. 权限边界

Preview Service 必须验证：

```text
media.user_id == current JWT sub
media.status == ready
media.media_type == file
media.ext_data.source == task
media.mime_type in [text/html, text/markdown, text/plain]
```

并验证对应 `taskId/taskRunId` 属于当前用户。

不存在、不属于用户、不是 Task Artifact 时统一返回：

```text
404 NOT_FOUND
```

避免泄露资源存在性。

### 2. Response

统一 JSON：

```ts
type TaskArtifactPreview = {
  mediaId: string;
  filename: string;
  mimeType: "text/html" | "text/markdown" | "text/plain";
  format: "html" | "markdown" | "text";
  content: string;
};
```

示例：

```json
{
  "success": true,
  "result": {
    "mediaId": "...",
    "filename": "result.html",
    "mimeType": "text/html",
    "format": "html",
    "content": "<!doctype html>..."
  },
  "errorCode": null,
  "errorMsg": null
}
```

### 3. 文件读取限制

Preview 只读取 UTF-8 文本型 Task Artifact。

限制：

```text
最大 2 MiB
```

超过限制返回：

```text
413 ARTIFACT_TOO_LARGE
```

### 4. MediaService

新增受控服务能力：

```ts
readTaskArtifact(userId, mediaId)
```

不允许 Route 直接访问 Media Repository 或 OSS。

返回领域对象：

```ts
{
  mediaId,
  filename,
  mimeType,
  bytes,
  content
}
```

### 5. OssStorage

新增：

```ts
getObject(key: string): Promise<Buffer>
```

该方法只供领域 Service 使用。

---

## 十、HTML Preview 媒体解析

### 1. 不使用 iframe URL 直接请求受保护 API

禁止：

```html
<iframe src="/api/tasks/artifacts/:mediaId/preview">
```

因为浏览器 iframe 导航无法由 H5 注入 Bearer Header。

### 2. H5 获取方式

H5：

```text
authorized fetch
  -> GET /api/tasks/artifacts/:mediaId/preview
  -> content
  -> HTML media resolver
  -> iframe srcDoc
```

最终：

```tsx
<iframe sandbox="" srcDoc={resolvedHtml} />
```

### 3. HTML media resolver

H5 解析 Preview API 返回的 HTML，查找：

```text
fanto-media://<mediaId>
```

支持属性：

```text
img.src
audio.src
video.src
source.src
```

对每个唯一 mediaId 调用现有：

```http
GET /api/media/:mediaId/url?variant=original
Authorization: Bearer ...
```

获得短期 OSS signed URL。

替换 HTML 内部 URL 后写入 iframe `srcDoc`。

即：

```text
fanto-media://abc
        ↓
resolveMediaUrl("abc")
        ↓
https://oss...signed...
```

无需让 iframe 或 `<img>` 请求 Fanto Bearer API。

### 4. 解析失败

单个 mediaId 无法获取时：

- 不导致整个 Artifact Preview 失败；
- 将对应元素替换为不可用占位；
- 不显示 raw mediaId；
- Preview 主内容继续展示。

### 5. Signed URL 生命周期

复用现有 `resolveMediaUrl()`：

- signed URL 约 5 分钟；
- H5 内存缓存；
- Preview 重新打开时重新解析；
- 不持久化 signed URL；
- 不写入 TaskRun.result；
- 不写入 Session History。

---

## 十一、HTML Preview 安全边界

Task Agent 生成的 HTML 一律视为不可信 HTML。

### 1. iframe

必须：

```tsx
<iframe sandbox="" srcDoc={resolvedHtml} />
```

V1 不添加：

```text
allow-scripts
allow-same-origin
allow-forms
allow-popups
allow-top-navigation
```

### 2. HTML 清洗

在写入 `srcDoc` 前进行 HTML sanitization。

至少移除：

```text
script
iframe
object
embed
base
meta[http-equiv]
link[rel=preload]
```

移除所有：

```text
onload
onclick
onerror
on*
```

属性。

移除：

```text
javascript:
data:text/html
```

等可执行 URL。

允许：

- HTML 结构；
- inline style；
- 图片；
- audio/video；
- 普通超链接。

外链点击统一：

```text
target=_blank
rel=noopener noreferrer
```

### 3. CSS

V1 允许页面内：

```html
<style>...</style>
style="..."
```

不加载本地相对 CSS 文件。

外部 stylesheet 默认移除，保证 Preview 不依赖第三方资源。

### 4. Script

V1 HTML Artifact 只定义为“可视 HTML 页面”，不是可执行 Web App。

所有 script 禁用。

交互式 HTML App 后续单独设计独立 Preview Origin 与权限模型。

---

## 十二、Markdown Preview

Markdown 不进入 iframe。

H5：

```text
GET Artifact Preview
  -> format=markdown
  -> FantoMarkdown
```

将当前 `ChatMarkdown` 抽取为可复用：

```text
FantoMarkdown.tsx
```

统一处理：

- GFM；
- `fanto-media://` image；
- `fanto-media://` audio；
- 外链；
- loading / failed media 状态。

Chat 使用：

```tsx
<FantoMarkdown text={message.text} />
```

Task Artifact 使用：

```tsx
<FantoMarkdown text={artifact.content} />
```

避免 Task Preview 再实现第二套 Markdown 媒体解析。

---

## 十三、Text Preview

`text/plain`：

- 直接在 Preview 容器中展示；
- 保留换行；
- 使用 `white-space: pre-wrap`；
- 长行可换行；
- 不执行任何 HTML。

---

## 十四、Artifact Preview UI

TaskRun 成功且存在 artifacts 时：

```text
结果
<summary>

result.html
HTML · 28 KB
[预览] [下载]

notes.md
Markdown · 4 KB
[预览] [下载]
```

### 1. 预览

点击“预览”：

- 在 Task Detail 内切换到 Artifact Preview；或
- 打开 Task Detail 内二级全屏 Preview Overlay。

移动端推荐全屏 Overlay；桌面端可用宽 Modal。

### 2. 下载

下载继续使用现有 media signed URL：

```http
GET /api/media/:mediaId/url?variant=original
```

H5 先 authenticated fetch 获取 signed URL，再通过普通链接打开该 OSS URL。

不使用：

```text
/api/media/:id
```

直接作为 `<a href>`，避免 Bearer Header 问题。

---

## 十五、H5 Tasks API Client

新增 `apps/h5/src/api/tasks.ts`。

定义：

```ts
export type TaskDto = { ... };
export type TaskRunDto = { ... };
export type TaskArtifactDto = { ... };
export type TaskArtifactPreviewDto = { ... };
```

能力：

```ts
listTasks()
getTask(taskId)
listTaskRuns(taskId)
getTaskRun(taskId, runId)
pauseTask(taskId)
resumeTask(taskId)
cancelTask(taskId)
getTaskArtifactPreview(mediaId)
```

全部复用 `requestJson()`，自动携带当前 H5 Bearer JWT。

---

## 十六、Server 路由目标

保留：

```http
GET    /api/tasks
GET    /api/tasks/:taskId
GET    /api/tasks/:taskId/runs
GET    /api/tasks/:taskId/runs/:runId
POST   /api/tasks/:taskId/pause
POST   /api/tasks/:taskId/resume
DELETE /api/tasks/:taskId
```

新增：

```http
GET /api/tasks/artifacts/:mediaId/preview
```

注意路由注册顺序，`/tasks/artifacts/:mediaId/preview` 必须避免被 `/tasks/:taskId` 动态参数吞掉。

推荐在 Hono 中先注册 artifact preview，再注册 `/:taskId` 路由；或将 artifact preview 单独挂载在明确子 Router。

---

## 十七、Task Detail 数据刷新策略

不增加聚合字段。

### Tasks Page

进入页面：

```http
GET /api/tasks
```

手动状态变更后重新请求。

### Task Detail

打开：

```http
GET /api/tasks/:taskId
GET /api/tasks/:taskId/runs
```

若存在：

```text
run.status == running
```

每 3 秒只刷新：

```http
GET /api/tasks/:taskId/runs
```

当 running 消失后：

```http
GET /api/tasks/:taskId
GET /api/tasks/:taskId/runs
```

刷新一次最终状态并停止轮询。

不在 Tasks List 层执行 N+1 Run 查询。

---

## 十八、create_task 后的即时体验

完成链路：

```text
用户：帮我整理最近的旅行记录，做个网页

Main Agent
  -> create_task

SSE tool_end(create_task)
  -> H5 收到 task_created

Assistant：
  “好，我放到后台整理了。”

  [TaskCard]
  整理最近的旅行记录
  已创建后台任务 · HTML
  查看任务 →
```

TaskCard 不等待后台 Worker 启动，也不依赖 `/api/tasks` 请求才能出现。

刷新聊天后由 Session History 中持久化的 Tool Result 恢复同一 TaskCard。

---

## 十九、任务完成后的体验

用户从 TaskCard 或导航进入 `/tasks`：

```text
任务

整理最近的旅行记录
已完成
HTML
```

打开详情：

```text
整理最近的旅行记录

目标
整理最近一个月的旅行记录并生成可预览网页

执行记录
2026-09-30 10:30
✓ 已完成
已整理 8 条相关记录并生成旅行回顾页面

result.html    HTML · 28 KB
[预览] [下载]
```

点击预览：

```text
GET /api/tasks/artifacts/<mediaId>/preview
Authorization: Bearer ...

HTML content
  -> resolve fanto-media://...
  -> signed OSS URL
  -> sanitize
  -> iframe srcDoc
```

用户无需下载 HTML，也无需手动补图片。

---

## 二十、主要代码改动范围

### Server

```text
apps/server/src/domain/tasks/model.ts
apps/server/src/domain/tasks/service.ts
apps/server/src/agent/tools/task-management.ts
apps/server/src/agent/harness/events.ts
apps/server/src/routes/agent/stream.ts
apps/server/src/routes/tasks.ts
apps/server/src/domain/media/media-service.ts
apps/server/src/infrastructure/clients/oss-client.ts
apps/server/src/task-runtime/result-publisher.ts
apps/server/src/agent/prompts/task-worker.ts
```

按需要新增：

```text
apps/server/src/domain/media/task-artifact-preview.ts
```

或将能力保持在 `MediaService`，不要为一次读取额外制造复杂 Domain 层级。

### H5

```text
apps/h5/src/api/agent.ts
apps/h5/src/api/tasks.ts
apps/h5/src/app/App.tsx
apps/h5/src/components/AppShell.tsx
apps/h5/src/pages/ChatPage.tsx
apps/h5/src/pages/TasksPage.tsx
apps/h5/src/components/TaskCard.tsx
apps/h5/src/components/tasks/TaskListItem.tsx
apps/h5/src/components/tasks/TaskDetailModal.tsx
apps/h5/src/components/tasks/TaskArtifactPreview.tsx
apps/h5/src/components/FantoMarkdown.tsx
apps/h5/src/styles/global.css
```

现有 `ChatMarkdown.tsx` 内容迁移到 `FantoMarkdown.tsx` 后可删除或保留薄包装。

---

## 二十一、测试目标

### Server Unit / Route Tests

必须覆盖：

1. `create_task` Tool Result 包含产品展示所需字段；
2. `create_task` 成功 Tool Result 经 sanitizer 后进入 SSE；
3. 其他 Tool Result 仍不能透出；
4. Session History 仍保存原生 create_task Tool Result；
5. Task Artifact Preview 只能读取当前用户自己的 ready task file；
6. 其他用户 mediaId 返回 404；
7. 普通上传 media 不能被 Task Artifact Preview 读取；
8. 非 text/html / markdown / plain 的 file 不能 Preview；
9. 超过 2 MiB 的 Artifact 被拒绝；
10. HTML 相对本地图片路径交付失败；
11. Markdown 相对图片路径交付失败；
12. `fanto-media://<mediaId>` 允许交付；
13. Task routes 仍保持 user-scoped。

### H5 Tests / Manual Verification

必须验证：

1. create_task 成功后当前聊天立即出现 TaskCard；
2. 刷新 Chat 后 TaskCard 仍存在；
3. 点击 TaskCard 自动进入 Tasks 页面并打开对应 Task；
4. Tasks 页面可看到全部任务；
5. Task Detail 可看到 Runs；
6. running Run 打开 Detail 时自动刷新，完成后停止轮询；
7. completed Run 展示 artifacts；
8. Markdown Artifact 正常显示 Fanto 图片；
9. HTML Artifact 正常显示 Fanto 图片；
10. HTML Artifact 中脚本不能执行；
11. HTML 中失效 media 不导致整个页面失败；
12. 下载 Artifact 不需要把 Bearer Token 放进 URL；
13. pause / resume / cancel 后页面状态正确刷新。

仓库验证：

```bash
pnpm --filter @fanto/server typecheck
pnpm --filter @fanto/server test
pnpm --filter @fanto/h5 typecheck
pnpm typecheck
pnpm test
```

---

## 二十二、最终产品边界

完成本方案后，Fanto 的 Task 用户体验形成以下稳定边界：

```text
Chat = 创建任务并告诉用户“创建了什么”
Tasks = 查看和管理任务
TaskRun = 查看一次真实执行状态和最终结果
Artifact = Task 的实际交付物
Preview = Fanto 域内安全查看交付物
Media = Artifact 内图片/音频的统一资源协议
```

Task 创建、执行、结果和预览都不再依赖聊天自然语言猜测状态。

用户不需要理解 Agent Tool、Worker Session、OSS、Bearer Header 或 mediaId。

内部仍保持：

```text
JWT user boundary
Task / TaskRun 两表
Media 统一存储
TaskRun.result.artifacts
短期 OSS signed URL
Agent Tool Result 原生持久化
```

不增加新的任务状态模型，不增加 Progress 产品层，不增加 latestRun 聚合，不引入新的鉴权机制。
