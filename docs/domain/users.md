# Users 与个人资料

AuthService 管理用户、登录身份、一次性 challenge 和令牌；UserProfileService 管理用户资料与统计，与 Fanto 角色设置分开。接口契约统一见 [HTTP API](../api/http-api.md#认证)。

## 登录身份

`user_login_identities.contact_value` 保存 Provider 返回的未脱敏联系方式，可为空：Google / Apple 从已校验签名的 ID Token 读取邮箱；Apple 隐藏邮箱时保存实际返回的转发邮箱，不推断真实邮箱。手机身份保存已验证的国际格式号码（如 `+8613800138000`），并与该身份的 `provider_subject` 一致。当前尚无短信 Provider，只有数据契约和通用身份写入支持。

注册、统一认证新建用户、登录、绑定与重新绑定均写入联系方式；后续验证返回新值时更新，缺少或空值时保留已有联系方式及脱敏提示，首次缺失则为 NULL。不从客户端自报的邮箱 / 手机号或脱敏提示反推原文，不按邮箱自动合并账号；身份唯一性仍为 `(provider, provider_subject)`。账号与绑定接口继续只返回 `displayHint`，不返回原始联系方式；SQL 日志不记录参数值。

## 资料与媒体

user_profiles 以 user_id 标识用户资料，保存 nickname、signature、avatar_media_id、cover_media_id、version 和更新时间。资料按当前 JWT 用户隔离；PATCH 只合并当前字段并校验版本，冲突返回 VERSION_CONFLICT。未保存时使用默认昵称“你”、空签名 / 媒体与 version=0。

昵称为单行 1–30 个 Unicode 字符，签名为单行最多40字；头像仅接受本人 ready 的 user_avatar，背景图仅接受本人 ready 的 user_cover。裁切上传后绑定引用，旧媒体退役 / 清理不能删除仍被使用的对象；媒体生命周期见 [Media](media.md)。用户资料不会自动注入角色 Prompt。

## 统计

统计读取本人 users.created_at 和现存 Record 总数，相伴日按请求时区的民用日历计算，注册当天为1。亲密度暂固定12，并标记为占位值；没有额外统计表。记录创建 / 删除后客户端定向刷新缓存，不用分页条数代替总数。
