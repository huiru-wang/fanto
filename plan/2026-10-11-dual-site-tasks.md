# 国内 / 新加坡双站点执行任务

状态：未执行。配套设计：[双站点方案](2026-10-11-dual-site-design.md)。

只在用户明确授权实施后执行代码 / 部署变更。以下任务基于当前工作区最终代码，保留其他未提交变更。

## T1. 显式站点配置与统一加载入口

- 新增 siteId 和 storage provider union，按选定 provider 验证必需配置；未知值 / 空值 / site 不匹配拒绝启动。
- 统一显式 env-file 策略，移除 main / migrate 隐式 .env 重读；开发、生产和迁移都必须明确选择文件。
- 环境在 imports 前注入；约定覆盖优先级，部署拒绝关键变量被意外继承覆盖。迁移仅校验站点 / DB 必需项。
- 在 migration 前完成完整 Server 配置和 Client 工厂校验。
- 验收：配置错误不会监听端口或先改库；选定日志目录在 import 时生效；迁移无需无关存储 / AI 密钥。

## T2. 提取存储契约并改造 Aliyun 实现

依赖：T1。

- 新增 ObjectStorage、SignedUrl、ObjectMetadata、MediaVariant 契约。
- 将 ali-oss 封装为 AliyunStorage，返回标准 HEAD、Buffer、Promise 签名与 expiry；保留 OSS 实时缩略图。
- 完成不存在 / 权限 / 网络错误分类、删除幂等、安全日志；工厂显式选择 provider。
- 验收：Aliyun 所有既有能力有契约覆盖；Domain 不依赖 Aliyun SDK 响应。

## T3. R2 实现与私有缩略图

依赖：T2。

- 接入 AWS S3 Client / presigner，配置 R2 endpoint、auto region、私有 Bucket 和 scoped credentials。
- 实现上传 / 读取签名、HEAD、读写与删除，按契约统一 expiry 与错误。
- 复用 sharp 实现版本化派生缩略图，缓存命中直接签名、仅明确不存在时生成；限制并发、大小、解码像素与超时。
- 原对象删除时分别尝试清理派生对象；记录与当前尽力删除一致的孤儿边界。
- 验收：真实 R2 测试 Bucket 上传 / 下载闭环；thumbnail 为私有 600 宽 q80 WebP，原图保持可用，失败无伪签名 URL。

## T4. 替换业务依赖并回归完整媒体链路

依赖：T2、T3。

- main 通过工厂注入唯一 ObjectStorage；MediaService 与 postprocess Listener 移除 OssStorage 类型依赖。
- complete 使用标准 metadata；更新 createUpload / readUrl / redirectUrl / withGenerationReferences 的 await 与 expiry。
- Vision / ASR 异步取得签名后再调用 Client，签名失败落入现有媒体错误处理。
- 更新相关测试替身及日志测试，验证 Project 复制、生成图和 Record 删除。
- 验收：HTTP 响应结构及 user-scoped 边界不变；两 provider 参数化业务测试通过；不存在 Promise 被当成 URL。

## T5. 双站点脚本、PM2、Nginx 与资源清单

依赖：T1、T4。

- 新建 deploy/common、deploy/cn、deploy/sg；分别提供 start / stop / restart / deploy / publish-h5 / PM2 / Nginx 配置入口。
- 复杂部署步骤复用 common；入口固定本站，分离 env、日志、workspace、H5 dist 与发布目录；root package.json 提供 cn/sg 命令，旧默认入口明确废弃或报错引导。
- 两站点使用独立 DB、Bucket、JWT issuer / key sets、模型凭据与备份。国内复用现有数据，新加坡初始化空库；不复制业务数据。
- Nginx 保留 SSE 设置；独立站点配置安装、nginx -t 后 reload；本站 --resolve HTTPS 检查去除 -k。
- 准备域名 / 证书 / 续期钩子 / Bucket CORS；提供只输出安全字段的配置预览和 site / provider / commit 识别。
- 验收：脚本选择测试证明 start/stop/migrate/publish 只作用本站；缺配置失败；证书可信；存储 smoke 与 DB health 分开。

## T6. iOS 构建站点与本地状态隔离

依赖：T5 的域名与认证配置约定；可先使用占位配置编译，不作为可连接发布。

- 增加 CN / SG Scheme 和对应 Debug / Release xcconfig，Info.plist 传入 siteId / API URL。
- 新增唯一 SiteConfiguration，四个 API Client 统一注入；校验 HTTPS / site，移除硬编码域名。
- Auth Keychain、Agent Session、Record 快照加入 site namespace；旧 namespace 明确清理并重新登录，不向 sg 导入。
- 核对 Bundle ID、Google / Apple audiences、URL Scheme 与 signing capabilities。
- 验收：两个 Scheme 编译通过；四类请求始终去同一对应站点；替换安装 / 相同 userId 不能复用异站状态。

## T7. H5 分站点构建与测试认证

依赖：T5。

- 保留相对 /api；通过独立 mode / envDir / outDir 构建站点产物，写入 VITE_SITE_ID，必要缓存 key 加 site。
- 每站点单独签发受控测试 refresh token 并配置；检查 Vite 没有读取旧通用 .env 或复用异站 dist。
- 两 Bucket 按本站 Origin 配置 CORS 和实际上传 Content-Type。
- 验收：两 Origin 上传 / complete / 缩略图 / SSE 闭环通过；A 构建不含 B 测试凭据；公众生产认证边界未被误述。

## T8. 双站点验收、发布与 Current Docs 更新

依赖：T1–T7。

- 执行 pnpm typecheck / pnpm test、iOS 两 Scheme build、bash -n / 脚本目标测试、nginx -t；数据库测试仅使用隔离 TEST_DATABASE_URL。
- 两站点分别 smoke：登录、媒体直传 / complete / 读取、Vision / ASR、Proposal / Creator、生图参考 URL 与 Project 副本、删除。
- 验证双向 JWT / refresh token 拒绝、DB / Bucket 独立、客户端 namespace 隔离及单站操作不影响另一站。
- 分站点记录 commit、资源标识、安全配置摘要与 smoke 结果；发布前确认实际新加坡域名、凭据、TLS 和 R2 驻留边界符合预期。
- 国内上线时明确通知重新登录；保留原 DB / Bucket。按本站 migration 兼容性准备回退，不承诺不可逆迁移回滚或队列无损重启。
- 更新最终实现影响的 Current Docs、README 与根 / 模块 AGENTS，按职责链接，避免重复；不将局部更新视为完整 checkpoint review。
- 验收：设计文档第 8 节通过且真实部署可用后才标记完成；未配置 / 未验证项明确记录，不能用 Mock 测试代替公网闭环。

## 顺序与发布前输入

顺序：T1 → T2 → T3 → T4 → T5 → T6 / T7 → T8。客户端任务可在接口和配置契约稳定后独立推进，无需新增业务 API。

实施不依赖现在就取得真实生产密钥。上线必须取得：新加坡域名与 DNS 控制权、两站点资源清单和受限凭据、独立 TLS 证书、iOS 分发 / Bundle ID 决策，以及是否要求严格新加坡驻留的明确约束。密钥经服务器受控配置渠道提供，不写入 plan 或源码。
