# 当前 MVP 能力与边界

本页只描述当前已在仓库接入的能力；运行约束以 [架构](../architecture/overview.md)、[HTTP API](../api/http-api.md) 和客户端文档为准。

## 记住：Record 与 Memory

- Record 支持文本、图片、音频、发生时间和结构化地点（地点名称、行政区、经纬度）。服务端保存原始 block，异步补充图片描述与音频转写；每条 Record 一个可派生的 pgvector 索引。内容更新/删除按 version 校验。
- H5 可创建文字/图片/音频记录、录音、浏览时间线和搜索记录。iOS 支持日历/连续时间线、文字与最多五张图片创建、定位建议/地点搜索/地图选点、Record 删除、图片全屏与音频播放；iOS 创建页尚无录音入口。
- Memory 是用户明确要求保存的独立 profile/goal/guidance；Main Agent 通过 memory_manage 创建、检索、修改与删除，guidance 可用于长期表达偏好。目前不提供从全部 Record/聊天自动无条件提取长期 Memory 的能力。

## 发现：Proposal

- 启用 `CREATIVE_ENABLED=true` 后，新 Record 完成后置理解会异步提交 Proposal Agent。Agent 根据素材本身判断是否值得创作；不值得可不提议。Creative Skill 的「入画、异想、成章、回声」是创作方法参考，不是必须凑齐的四种候选。
- Proposal 最多含两个方向；每个方向提供标题、成品可感知描述、少量 tags 和内部 Goal。用户可接受选定方向或拒绝；接受后 Project 立即成为 queued，Creator 后台执行。
- H5/iOS 均已实现 Proposal 列表、查看参考 Record、选择创作方向及接受/拒绝。创作结果不可仅由 Proposal 文案推断为已经执行。

## 继续：Project

- Project 保存当前标题、摘要、Goal、完整图文 Markdown 或安全静态 HTML、封面、参考 Record 和长期 Creator Session。状态：queued、running、completed、failed、archived。
- Creator 可基于用户授权参考图片生成单张图（可多次独立调用），通过 project_manage 更新最终作品；只有引用进入最终正文/封面的外部素材才复制为 Project OSS 独立资产，避免源 Record 删除破坏成果。
- H5/iOS 均已接入 Project 展示、状态刷新、归档及同一 Creator Session 的继续创作。会话采用通用 History、Agent Stream 和 Tool Presentation；首次异步创作可以只读订阅 Session Events。SSE 是实时可视化而不是历史真相，断连后通过 History 恢复。
- 当前不是通用视频制作器、自动长期跟进引擎或 3D 编辑器；创作能力受模型、授权素材、Markdown/静态 HTML 输出和现有工具边界约束。

## Main Agent 与后台 Task

- Fanto 主对话是一个持久 Session，支持文字 SSE、原生媒体展示、工具活动、必要时的澄清表单；按需使用 Record 检索和显式 Memory 管理。
- Main Agent 可用 create_task/update_task/get_task 管理后台 Task。唯一 task-worker 能整理信息、查询公开网页、生成文本/Markdown/受控 HTML 文件并交付 OSS；TaskRun 保存 plan、summary、artifacts，客户端提供 Task 详情和产物预览。
- TaskScheduler 定时扫描到期 Task，即时创建可主动唤醒；先创建 queued TaskRun，再由共享 AgentExecutionQueue 处理。没有消息持久化、自动重试或重启恢复保证；客户端不可把 queued/running 误解为必然最终完成。
- Worker 的 read/write/edit/bash 仍在宿主进程工作区约束下运行，生产场景不能将其当成完整沙箱。

## 客户端与运营范围

- iOS：SwiftUI，Google/Apple 原生登录、品牌启动页预加载、Record、Fanto 主对话、Proposal/Project；正式的多会话管理和独立任务中心尚未提供。
- H5：React/Vite，作为受控测试客户端使用构建时 refresh token 换取 JWT；没有公开的正式登录流程。
- Server：单 Hono 进程内嵌 Pi Agent、PostgreSQL + pgvector、OSS、内存事件队列；部署依赖 Nginx/PM2。所有受保护 API 使用 Fanto JWT 用户归属校验。
- 路由和 UI 的已接入不代表当前线上服务已经部署相同版本；实际在线功能需另做生产环境验收。

详情见 [iOS](../clients/ios.md)、[H5](../clients/h5.md)、[Agent Runtime](../architecture/agent-runtime.md) 和 [创作执行](../architecture/creative-runtime.md)。
