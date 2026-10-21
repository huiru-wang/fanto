# H5 Google 登录执行任务

状态：待执行。修订：内存 Access Token + HttpOnly Refresh Cookie + 服务端可撤销登录会话；通用表 auth_sessions / auth_refresh_tokens 支持 client_type 与同用户多会话。前置方案：`2026-10-22-h5-google-auth-design.md`。本清单不代表代码已变更。

| 顺序 | 任务 | 主要范围 | 依赖 | 完成标准 |
| --- | --- | --- | --- | --- |
| 1 | 核对 Web Client ID、Google 来源与本地 HTTPS；定义环境参数 | H5/Server config 与 env.example、Vite、Google Cloud | 无 | Web ID 与 Server audience 一致且保留 iOS audience；AUTH_WEB_ORIGIN 为精确实际来源；配置空闲 30 天/绝对 90 天；本地 HTTPS 不降级 Cookie；移除固定测试认证配置；落实协议页面发布安排 |
| 2 | 新增通用登录会话迁移与类型 | migrations/004_create_auth_sessions.ts（执行前核对编号）、database/schema.ts | 1 | auth_sessions(client_type=web/ios) 与 auth_refresh_tokens；同用户同类型多会话不设唯一限制；用户/会话关联与必要索引；只存摘要；独立空库/已有库迁移回归；旧迁移不变 |
| 3 | 实现 AuthSessionService 与 Web JWT | domain/auth/auth-session-service.ts、jwt-token-service.ts、auth-service.ts | 2 | 身份认证与会话创建同事务；client_type由可信入口指定；会话服务不依赖Cookie；Access带sid/auth_client并核对会话类型；30天空闲与90天绝对上限；行锁轮换；10秒冲突409/超期重用撤销；仅当前sid幂等撤销、不影响同用户其他会话；原生签发/刷新保持兼容；清理命令及7天保留窗口 |
| 4 | 新增 Web 认证 Route 与请求安全边界 | routes/auth-web.ts、bootstrap/app.ts/config.ts/main.ts、AuthError、脱敏 | 1、3 | 四个 Web POST 端点；intent delivery 隔离；Cookie 全属性与清除正确；JSON 不返回 Refresh；Origin+JSON+自定义头校验；Web CORS 与通配策略分开；no-store；每次业务验证 Web sid、不用24小时缓存；DB故障503；退出后旧Access拒绝 |
| 5 | 实现 H5 内存会话与跨标签页协调 | auth/session.ts、AuthProvider、api/auth/http/agent | 4 | 启动 Cookie refresh，无 token 持久化；单页刷新去重；Web Locks 串行化 Cookie 变更，广播只传事件；有限409恢复；generation拒绝旧响应；网络失败保留可恢复状态；清除旧测试token；不扩大未知结果业务写入重试 |
| 6 | 接入 Google GIS 官方按钮 | SDK loader、Google button、Web intent 请求 | 5 | SDK 去重；按钮前准备 intent/nonce；credential一次消费；过期/取消/超时新尝试；登录与退出串行化；原生 intent 不跨通道消费；Client Secret 不进入H5 |
| 7 | 实现参考 iOS 的登录首页与稳定启动页 | 登录/启动组件、局部CSS、复用品牌资源 | 6 | 精灵+标语+渐变；Google唯一主操作；等待身份与角色时稳定品牌页；15秒网络超时后真实错误与重试；375/390/1280布局、低动态与键盘可访问 |
| 8 | 接入导航、角色门禁和服务端退出 | main.tsx、App.tsx、AuthGate、FantoContext、FantoListPage | 5、7 | React立即挂载；恢复后才请求角色；固定Session校验后才挂ChatPage；内部深链恢复；退出撤销当前浏览器会话、清Cookie、广播清理；退出网络失败显示待确认；晚到Set-Cookie不能恢复已撤销会话 |
| 9 | 收紧 Google 验证与上游故障分类 | Google Provider、AuthError 与测试 | 可在1后独立执行 | exp必填；签名/issuer/aud/nonce/sub/expiry覆盖；JWKS临时故障503；保持sub主身份、联系方式现有契约 |
| 10 | 完成安全/状态/兼容自动化与真实浏览器验收 | H5测试、Server Route/JWT/会话测试、隔离PG、浏览器 | 2–9 | typecheck/test/build通过；Cookie/CSRF/CORS/native兼容/轮换并发/重放/退出竞态/会话清理/同账号多端及同类型多会话隔离/client_type约束/跨账号隔离回归；浏览器关闭重开自动恢复；真实Google首次及已有用户通过；不以mock冒充线上验收 |
| 11 | 同步Current Docs并做发布检查 | H5/Server AGENTS，clients/h5、domain/users、http-api、engineering、product、architecture、必要时README，部署 | 10 | 文档与最终代码一致；先迁移后启服务；H5重建；真实HTTPS Cookie/GIS/Origin/协议链接验收；部署环境精确来源与定期清理可运行；明确当前浏览器退出与非全部设备注销；不自动推进docs/.checkpoint |

发布依赖与风险：

- Google Cloud 设置需已保存，Audience 包含验收账号或已正确发布；不能由本地代码替代控制台核实。
- 公网入口前序只读检查返回403，最终验收需查明实际可达性；不据此断定认证代码故障。
- 首次Web登录需要新建服务端会话，不把历史固定测试Token升级为Web凭证。本期H5写client_type=web；模型支持ios但iOS保留原生JSON Refresh契约，不迁移其客户端存储或历史Token。
- HttpOnly防止脚本直接读取Refresh，不消除XSS；所有Web认证POST均校验精确Origin与非简单请求头，不能继承全局通配CORS。
- Web sid检查不缓存，撤销阻止之后的新业务请求；已经开始的SSE/工具不承诺回滚或强制终止。
- 一个用户可同时拥有多个同类型或不同类型登录会话，client_type不是设备ID，不对(user_id,client_type)设唯一约束。多个浏览器/设备独立刷新与退出；不提供设备列表、踢下线、全部设备退出页面或API。
- 多标签页共享同源Cookie；退出影响该浏览器登录会话，不影响其他设备。登录/刷新/退出需串行化，并覆盖响应丢失、晚到Cookie、登出失败等情况。
- 轮换冲突只做有限恢复；服务器已消费旧Token但浏览器未收到新Cookie时，无法安全恢复就要求重新登录，不能保存Refresh原文或无限重试。
- 协议与隐私当前只有约定地址，公开发布前落实真实可读内容及路由。
- 所有PG写测试使用独立TEST_DATABASE_URL；浏览器登录验收无需调用付费模型。
- 开始实施前检查最新工作区与migration编号；不覆盖他人修改，不改聊天玻璃效果或Agent对话契约。

完整目标变更目录见技术方案第9节。
