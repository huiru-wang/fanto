# 当前 MVP 能力与边界

本页只描述当前已在仓库接入的能力；产品主线是 Fanto 角色扮演与深度陪伴对话，定位见 [愿景](vision.md)。iOS 当前开放记录、Fanto、我的三个 Tab，每次启动默认进入记录页；脉络入口隐藏。Proposal / Project 与后台创作实现保留，隐藏 iOS 入口不会自动关闭 CREATIVE_ENABLED。运行约束以 [架构](../architecture/overview.md)、[HTTP API](../api/http-api.md) 和客户端文档为准。

## Record 与 Memory：对话上下文

- Record 支持文本、图片、音频、发生时间和结构化地点（地点名称、行政区、经纬度）。服务端保存原始 block，异步补充图片描述与音频转写；每条 Record 一个可派生的 pgvector 索引。内容更新/删除按 version 校验。
- H5 可创建文字/图片/音频记录、录音、浏览时间线和搜索记录。iOS 支持日历/连续时间线、文字与最多五张图片创建、已授权位置地图预览/地点搜索/地图选点、按账号本地创建草稿恢复、Record 删除、图片全屏与音频播放；iOS 创建页尚无录音入口。
- Memory 分个人背景、重要关系、近期关注、相处偏好；Main Agent 可判断保存明确且持续有用的用户自述，补充、纠错与递进更新原条目。个人背景与相处偏好默认注入，其余按话题检索。没有逐消息后台提取或整理；规则见 [Memory](../domain/memory.md)。

## 保留能力：Proposal

- 启用 `CREATIVE_ENABLED=true` 后，新 Record 完成后置理解会异步提交 Proposal Agent。Agent 根据素材本身判断是否值得创作；不值得可不提议。Creative Skill 的「入画、异想、成章、回声」是创作方法参考，不是必须凑齐的四种候选。
- Proposal 最多含两个方向；每个方向提供标题、成品可感知描述、少量 tags 和内部 Goal。用户可接受选定方向或拒绝；接受后 Project 立即成为 queued，Creator 后台执行。
- H5 提供 Proposal 列表、查看参考 Record、选择创作方向及接受/拒绝；iOS 对应实现保留但入口隐藏。创作结果不可仅由 Proposal 文案推断为已经执行。

## 保留能力：Project

- Project 保存当前标题、摘要、Goal、完整图文 Markdown 或安全静态 HTML、封面、参考 Record 和长期 Creator Session。状态：queued、running、completed、failed、archived。
- Creator 可基于用户授权参考图片生成单张图（可多次独立调用），通过 project_manage 更新最终作品；只有引用进入最终正文/封面的外部素材才复制为 Project OSS 独立资产，避免源 Record 删除破坏成果。
- H5 已接入 Project 展示、状态刷新、归档及同一 Creator Session 的继续创作；iOS 对应模块保留但入口隐藏。会话采用通用 History、Agent Stream 和 Tool Presentation；首次异步创作可以只读订阅 Session Events。SSE 是实时可视化而不是历史真相，断连后通过 History 恢复。
- Fanto 主对话延续设置中的当前 Session；iOS / H5 不提供历史会话列表、手动切换或新建对话入口。首次建立 / 失效恢复和设置中的清除仍可创建并绑定 Session，当前 Session 的消息恢复与向上分页保持可用。
- 当前不是通用视频制作器、自动长期跟进引擎或 3D 编辑器；创作能力受模型、授权素材、Markdown/静态 HTML 输出和现有工具边界约束。

## Fanto 主对话

- H5 与 iOS 从主对话左上头像进入 Fanto 设置，支持昵称、简介、头像及四项角色配置。头像选择新图片后拖动/缩放裁切，仅上传小图；文字按版本保存，主对话下一轮读取昵称与角色配置。详见 [Fanto](../domain/fanto.md)。
- Fanto 主对话是一个持久 Session，支持文字 SSE、原生媒体展示、工具活动、必要时的澄清表单；按需使用 Record 检索和 Memory 管理。
- 主对话支持角色扮演与陪伴交流，工具能力围绕 Record 和 Memory；保留的发现与创作能力涉及 Proposal / Project。当前不提供即时、延时或周期 Task，不提供提醒、通用文件交付及个人助理工作流。创作执行依赖 Proposal 接受后启动 Creator，已存在 Project 可继续对话；Main 尚不能直接创建 Project。
- Proposal / Creator 使用进程内非持久化队列；没有消息持久化、自动重试或重启恢复保证。

## 用户中心

- iOS “我的”展示服务端相伴天数、全部记录数及暂固定12的亲密度占位值；可编辑用户头像、背景图、昵称和单行签名，使用独立的 user_profiles 与版本化 Profile API；用户头像和背景图仅上传裁切图片并立即绑定；昵称和签名在各自二级页独立保存。用户 / Fanto 头像用途互相隔离。
- 外观三选项与九种预设强调色通过原生菜单即时切换，仅保存在当前设备。账号页读取本人登录身份，可退出并清除本机凭据与缓存。
- 数据与隐私、帮助与反馈、关于及账号页已增加存储 / 导出 / 数据处理 / 反馈支持 / 注销等页面框架，未实现的入口明确标注尚未开放；Fanto 设置不提供记忆管理入口；清除对话记录经确认后创建并切换到新会话，保留旧会话、记忆与角色。帮助、条款、隐私政策在系统浏览器打开官网预留路径，网页内容待补充。退出登录使用中央确认弹窗。没有真正的用户端记忆管理、导出或注销流程，不提供系统权限设置项。

## 客户端与运营范围

- iOS：SwiftUI，Google/Apple 原生登录、品牌启动页预加载、Record、Fanto 主对话与角色设置；Proposal/Project 入口隐藏，“我的”已接个人资料、头像上传、设备外观偏好与退出登录，正式的多会话管理尚未提供。
- H5：React/Vite，作为受控测试客户端使用构建时 refresh token 换取 JWT；没有公开的正式登录流程。提供主会话 Session ID、Project 状态筛选与绑定 ID 的调试展示，限当前用户。
- Server：单 Hono 进程内嵌 Pi Agent、PostgreSQL + pgvector、OSS、内存事件队列；部署依赖 Nginx/PM2。所有受保护 API 使用 Fanto JWT 用户归属校验。
- 路由和 UI 的已接入不代表当前线上服务已经部署相同版本；实际在线功能需另做生产环境验收。

详情见 [iOS](../clients/ios.md)、[H5](../clients/h5.md)、[Agent Runtime](../architecture/agent-runtime.md) 和 [创作执行](../architecture/creative-runtime.md)。
