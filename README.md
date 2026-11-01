# DSH Remote Files

Read-only file browsing for Android/Proot and DSH: a small phone API, a localhost desktop UI, USB or mutual TLS transport, and optional Heart Protocol v1 integration. Node.js 24+, zero production dependencies. [MIT License](LICENSE).

面向 Android / Proot / DSH 的只读文件维护台：电脑按需查看手机登记目录中的当前文件，不必先做整包备份。

## 功能与范围

- 中文目录树、分页、普通文本预览、选中文件刷新、读取时间、截断和离线提示。
- 手机 API 只提供固定 GET 路由；浏览器通过 PC localhost 代理访问，拿不到手机访问口令。
- USB 回环连接；局域网要求 mTLS、配对证书指纹和独立访问口令。
- 可选 Cordis / Heart v1 适配：维护访问只上报元数据，Heart 缺席不阻断人工查看。
- 可选显示兼容 Vault 的已验证恢复点摘要；不触发备份，不持有仓库删除或生产恢复权限。
- 默认关闭，不注册模型工具；不提供 Shell、上传、删除、编辑或修复接口。

当前是普通文本查看器。SQLite 正文、压缩会话、图片/音频和历史快照文件浏览尚未实现；在线读取也不是跨文件一致快照。边界与后续方向见 [架构说明](docs/ARCHITECTURE.md)。

## 立即体验

在 **PC** 获取源码后：

```sh
git clone https://github.com/kirigayakazima/DSH-Remote-Files.git
cd DSH-Remote-Files
node test/demo.mjs
```

终端显示演示网址和演示口令。打开网址登录即可；演示只使用临时合成数据，五分钟后退出，Ctrl+C 提前关闭。运行不需要安装依赖。

## 连接真实手机

下面使用 USB，手机服务只监听 `127.0.0.1:22225`。需要 Node.js 24+、PC 的 Android platform-tools，以及已授权的 USB 调试连接。

### 1. PC 构建离线包

```sh
npm pack --ignore-scripts
node -e "const f=require('node:fs'),c=require('node:crypto'),p='dsh-remote-files-0.1.1.tgz';f.writeFileSync('checksums.txt',c.createHash('sha256').update(f.readFileSync(p)).digest('hex')+'  '+p+'\n')"
```

也可以使用 GitHub Release 的包和校验清单。通过自己的可信传输流程把二者送到手机共享更新目录。**手机端不需要联网安装依赖。** 已有 DSHA 工作区用户继续使用工作区统一推包器和校验安装流程。

独立运行可在 Proot 中先校验，再解压到一个新的版本目录，例如：

```sh
set -eu
cd /sdcard/dshproject/updates
sha256sum -c checksums.txt
mkdir -p /root/.local/share
mkdir /root/.local/share/dsh-remote-files-v0.1.1
tar -xzf dsh-remote-files-0.1.1.tgz --strip-components=1 -C /root/.local/share/dsh-remote-files-v0.1.1
```

新目录已经存在时 `mkdir` 会停止，先检查现有安装，不直接覆盖。

### 2. 手机配置与启动

初次配置，在 Proot 中创建独立私有目录和访问口令：

```sh
umask 077
mkdir -p /root/.dsh-remote-files
node -e "const f=require('node:fs'),c=require('node:crypto');f.writeFileSync('/root/.dsh-remote-files/access.token',c.randomBytes(32).toString('base64url')+'\n',{mode:0o600,flag:'wx'})"
```

已有口令时不要重新生成。参照 [手机配置示例](config.phone.example.json)，保存 `/root/.dsh-remote-files/phone.local.json`。先登记一个自己确认可以展示的普通文本目录；路径必须真实存在，不要登记包含此服务配置或凭据的上级目录。

```sh
node /root/.local/share/dsh-remote-files-v0.1.1/phone/serve.mjs /root/.dsh-remote-files/phone.local.json
```

DSH/Cordis 模式则按宿主 bundle 安装方式加载 `@dsh/remote-files`，将插件配置设为：

```yaml
enabled: true
configFile: /root/.dsh-remote-files/phone.local.json
```

两种启动方式只选一种。随包的 `cordis.patch.yml` 默认关闭；安装 bundle 不等于启动服务。`enabled/configFile` 属于插件配置，手机 JSON 是另一份运行配置。

### 3. PC 一次性加密配对

下面是 Windows PowerShell 示例，按实际安装位置修改变量：

```powershell
$PrivateDir = 'C:\Private\DSH-Remote-Files'
$Adb = 'C:\Android\platform-tools\adb.exe'
$Serial = 'YOUR_DEVICE_SERIAL'
node pc/pair-usb.mjs prepare $PrivateDir $Adb $Serial
```

工具在 PC 私有目录生成一次性私钥和 `pair-remote-files.mjs` 公钥脚本，输出手机执行命令。**只传送公钥脚本，不传送私钥。** 把公钥脚本放到输出命令指定的手机共享路径，由用户在 Proot 里执行那条命令。

脚本只读取 remote-files 的访问口令，将 RSA-OAEP-SHA256 密文写到共享更新目录，不输出原始口令，不读取其他业务文件。配对会话一小时有效。

PC 建立 USB 转发并完成配对：

```powershell
& $Adb -s $Serial forward --no-rebind tcp:22225 tcp:22225
node pc/pair-usb.mjs finish $PrivateDir $Adb $Serial
```

PC 读取密文、核对会话并认证服务，保存 `access.token`，另生成独立 `ui.token` 和 `pc.local.json`，随后删除一次性私钥。Windows 私有目录会关闭继承，仅授予当前用户和 SYSTEM 访问权限。

过期会话在新的私有目录重新配对；不要删除或覆盖已有可用凭据来排障。

### 4. 打开维护台

Windows 可直接使用启动器：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File pc/open.ps1 -ConfigFile "$PrivateDir\pc.local.json" -AdbPath $Adb
```

启动器复用或建立当前配对设备的 USB 转发，后台启动 PC 代理，打开网页，并将 **UI 口令**复制到本机剪贴板。页面按 Ctrl+V 登录。重复运行复用已有代理进程。

跨平台或手动启动：

```sh
node pc/browser.mjs /absolute/private/remote-files/pc.local.json
```

参照 [PC 配置示例](config.pc.example.json) 使用当前系统的绝对路径。手机与 PC 的 `access.token` 值相同，`ui.token` 必须不同。浏览器只持有 UI 口令，断开或关闭页面后清除；不放入 URL 或 localStorage。

## 局域网模式

手机绑定明确的 RFC1918 私网地址，PC 使用 `https://<手机地址>:22225/`。禁止 `0.0.0.0` 和公网监听；HTTP 只支持回环地址。

手机配置顶层、PC 配置的 `remote` 下分别增加：

```json
{
  "tls": {
    "keyFile": "/absolute/private/own-key.pem",
    "certFile": "/absolute/private/own-cert.pem",
    "peerCertFile": "/absolute/private/paired-peer-cert.pem"
  }
}
```

使用专用的直接配对端证书，每端只保存自己的私钥及对端公开证书；对端证书作为信任锚，同时验证指纹。PC 校验手机证书的 SAN/地址和有效期。证书签发与安全交换由维护者完成，本项目不自动签发、不修改防火墙、不忽略证书错误，不复用 Vault 私钥。

## 文件策略

- 使用逻辑根和相对路径；拒绝穿越、真实符号链接、特殊文件和普通文件的多硬链接读取。
- 隐藏常见令牌、密钥、`.env*` 与敏感配置；**文件名过滤无法识别普通文本里包含的秘密**，登记根本身就是授权。
- 默认预览 64 KiB、目录每页 200 项、并发 4；目录扫描最多 10,000 项。不后台扫描整棵数据树。
- 版本变化时拒绝过期读取；显示空目录、受限条目、真正 0 字节文件、截断和断线状态。
- 不建立源到缓存的硬链接，不改源权限、所有者或时间；读取可能影响 atime。
- Proot 的应用层检查不等于抵御同 UID 恶意进程的操作系统沙箱，也不能证明 Android 原生源形态。原生环境需要单独验证。

## Heart 与 Vault

Heart 通过 Cordis 的公开 `ctx.get('heart')` 可选发现；支持后装、卸载及 `heart/state-changed`。维护访问按分钟节流，仅发送 `type: custom` 的计数，不发送路径、正文和凭据，不直接改变 Mood。将来的后台重任务可调用活动评估；当前没有自动索引。

Vault 卡片是可选的 PC 本地集成，需要一个提供 `lib/status.mjs` / `readVaultStatus()` 的兼容 [DSH-Vault](https://github.com/kirigayakazima/DSH-Vault) 工作副本。PC 配置的 `vault.projectPath` 和 `vault.configFile` 使用本机可信绝对路径；不需要 Vault 也能完整使用文件查看。它只读取脱敏状态，不解密仓库凭据，不触发备份，也不提供历史快照浏览。

## 开发与测试

```sh
npm ci --ignore-scripts
npm test
npm pack --dry-run
```

开发依赖仅用于真实 Cordis 生命周期测试；生产依赖为零。TLS 测试需要 OpenSSL：Linux/macOS 使用 PATH，Windows 默认使用 Git for Windows 自带版本，也可设置 `OPENSSL`。

默认测试独立于其他仓库。可选真实 Heart 集成测试通过 `DSH_HEART_ROOT` 指定 [dsh-heart](https://github.com/kirigayakazima/dsh-heart) 工作副本；未设置时明确跳过该项。CI 固定 Heart 提交并运行完整测试，覆盖路径/链接、源身份、有界读取、Proot 目录枚举兼容、加密配对、mTLS、PC 代理和生命周期。

所有测试使用合成文件、临时凭据与临时证书，不访问真实手机或用户资料。已在 Android/Proot 的 USB 链路验证 0.1.1 的版本、认证、目录与文本读取；这不代替原生源形态或灾备验收。

## 变更与贡献

0.1.1 修复 Proot 下 Dirent 类型提示与 lstat 判断不一致导致的漏列文件问题，同时保留真实链接和路径限制。详情见 [CHANGELOG](CHANGELOG.md)。

贡献要求见 [CONTRIBUTING](CONTRIBUTING.md)，安全问题见 [SECURITY](SECURITY.md)。请勿提交本地配置、访问口令、配对材料、日志、记忆、备份或用户截图。
