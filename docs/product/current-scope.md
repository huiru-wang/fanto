# 当前 MVP 能力与边界

本页只描述当前已在仓库接入的能力；运行约束以 [架构](../architecture/overview.md)、[HTTP API](../api/http-api.md) 和客户端文档为准。

## 记住：Record 与 Memory

- Record 支持文本、图片、音频、发生时间和结构化地点（地点名称、行政区、经纬度）。服务端保存原始 block，异步补充图片描述与音频转写；每条 Record 一个可派生的 pgvector 索引。内容更新/删除按 version 校验。
- H5 可创建文字/图片/音频记录、录音、浏览时间线和搜索记录。iOS 支持日历/连续时间线、文字与最多五张图片创建、定位建议/地点搜索/地图选点、Record 删除、图片全屏与音频播放；iOS 创建页尚无录音入口。
- Memory 分个人背景、重要关系、近期关注、相处偏好；Main Agent 可判断保存明确且持续有用的用户自述，补充、纠错与递进更新原条目。个人背景与相处偏好默认注入，其余按话题检索。没有逐消息后台提取或整理；规则见 [Memory](../domain/memory.md)。

## 发现：Proposal

- 启用 `CREATIVE_ENABLED=true` 后，新 Record 完成后置理解会异步提交 Proposal Agent。Agent 根据素材本身判断是否值得创作；不值得可不提议。Creative Skill 的「入画、异想、成章、回声」是创作方法参考，不是必须凑齐的四种候选。
- Proposal 最多含两个方向；每个方向提供标题、成品可感知描述、少量 tags 和内部 Goal。用户可接受选定方向或拒绝；接受后 Project 立即成为 queued，Creator 后台执行。
- H5/iOS 均已实现 Proposal 列表、查看参考 Record、选择创作方向及接受/拒绝。创作结果不可仅由 Proposal 文案推断为已经执行。

## 继续：Project

- Project 保存当前标题、摘要、Goal、完整图文 Markdown 或安全静态 HTML、封面、参考 Record 和长期 Creator Session。状态：queued、running、completed、failed、archived。
- Creator 可基于用户授权参考图片生成单张图（可多次独立调用），通过 project_manage 更新最终作品；只有引用进入最终正文/封面的外部素材才复制为 Project OSS 独立资产，避免源 Record 删除破坏成果。
- H5/iOS 均已接入 Project 展示、状态刷新、归档及同一 Creator Session 的继续创作。会话采用通用 History、Agent Stream 和 Tool Presentation；首次异步创作可以只读订阅 Session Events。SSE 是实时可视化而不是历史真相，断连后通过 History 恢复。
- 当前不是通用视频制作器、自动长期跟进引擎或 3D 编辑器；创作能力受模型、授权素材、Markdown/静态 HTML 输出和现有工具边界约束。

## Main Agent

- H5 设置页可编辑并保存当前用户唯一的角色 Prompt 配置，主对话下一轮实时读取，无需新建 Session。
- Fanto 主对话是一个持久 Session，支持文字 SSE、原生媒体展示、工具活动、必要时的澄清表单；按需使用 Record 检索和 Memory 管理。
- 当前只提供 Record、Proposal 和 Project 相关的发现与创作，不提供即时、延时或周期 Task，不提供提醒、通用文件交付及个人助理工作流。创作执行依赖 Proposal 接受后启动 Creator，已存在 Project 可继续对话；Main 尚不能直接创建 Project。
- Proposal / Creator 使用进程内非持久化队列；没有消息持久化、自动重试或重启恢复保证。

## 客户端与运营范围

- iOS：SwiftUI，Google/Apple 原生登录、品牌启动页预加载、Record、Fanto 主对话、Proposal/Project；正式的多会话管理尚未提供。
- H5：React/Vite，作为受控测试客户端使用构建时 refresh token 换取 JWT；没有公开的正式登录流程。提供主会话 Session ID、Project 状态筛选与绑定 ID 的调试展示，限当前用户。
- Server：单 Hono 进程内嵌 Pi Agent、PostgreSQL + pgvector、OSS、内存事件队列；部署依赖 Nginx/PM2。所有受保护 API 使用 Fanto JWT 用户归属校验。
- 路由和 UI 的已接入不代表当前线上服务已经部署相同版本；实际在线功能需另做生产环境验收。

详情见 [iOS](../clients/ios.md)、[H5](../clients/h5.md)、[Agent Runtime](../architecture/agent-runtime.md) 和 [创作执行](../architecture/creative-runtime.md)。
