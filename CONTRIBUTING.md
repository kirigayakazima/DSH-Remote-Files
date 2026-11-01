# Contributing

需要 Node.js 24+ 和 OpenSSL。在 PC 执行 `npm ci --ignore-scripts`、`npm test`、`npm pack --dry-run`。生产依赖保持为零，开发依赖固定在锁文件；不要让手机在公网安装依赖。

改变文件策略、协议、配对或认证时，增加验证实际风险的合成回归测试。不要提交真实源、访问口令、密钥、配对会话、日志、记忆、备份或用户截图；示例配置只使用占位路径。

可选真实 Heart 集成通过 `DSH_HEART_ROOT` 指定本地工作副本；CI 使用固定公开提交。运行时仍可在没有 Heart 的情况下提供人工只读访问。

禁止通过创建源硬链接、修改源权限或放宽 NOFOLLOW 来修复兼容问题。PC 测试不能代替 Android 原生验证；说明复现环境、验证范围与限制。

PR 请描述触发条件、修改后的行为、相关验证，以及是否改变权限或数据语义。安全报告请遵循 [SECURITY.md](SECURITY.md)。
