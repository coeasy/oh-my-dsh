# 代码签名指南（Code Signing）

> 更新：2026-08-19

本文说明 my-dsh 桌面产物的**代码签名**现状与配置方法。签名不是功能前提，但它能消除 Windows SmartScreen 与 macOS Gatekeeper 的安全提示，提升分发体验与可信度。

## 当前状态

- **Windows / macOS 产物当前未签名**。
- Windows 未签名 exe 可能触发 SmartScreen“Windows 已保护你的电脑”，需点击“更多信息 → 仍要运行”。
- macOS 未签名 app 可能被 Gatekeeper 拦截，需在“系统设置 → 隐私与安全性 → 仍要打开”手动放行。
- Linux 产物（AppImage）不要求签名，保持现状。

未签名时无需任何操作即可构建与使用；以下配置仅在你**拥有签名证书**后按需启用。

## 证书来源

| 平台 | 证书类型 | 颁发方 |
|---|---|---|
| Windows | Authenticode 代码签名证书（OV 或 EV） | 任意受信任 CA（如 DigiCert、GlobalSign 等） |
| macOS | Apple Developer ID Application 证书 | Apple Developer Program |

> Windows 证书通常以 `.pfx` / `.p12` 提供；macOS 证书安装到钥匙串（Keychain）。

## Windows 代码签名

electron-builder 通过环境变量读取 Windows 证书：

| 环境变量 | 说明 |
|---|---|
| `CSC_LINK` | 证书路径（`file://` 或 `https://`）或 base64 编码的 `.pfx` 内容 |
| `CSC_KEY_PASSWORD` | 证书私钥密码 |

在构建前注入：

```powershell
$env:CSC_LINK = "file://C:\path\to\cert.pfx"
$env:CSC_KEY_PASSWORD = "your-password"
pnpm build:clients:stable
```

- 配置后 electron-builder 会自动对 NSIS 安装包与 portable exe 签名，SmartScreen 提示大幅减少。
- 未配置 `CSC_LINK` 时，产物保持未签名（当前默认）。
- EV 证书通常还需配合硬件令牌（如 USB Key），请按证书厂商指引操作。

## macOS 代码签名与公证

macOS 除了签名，还建议做 **Apple 公证（notarization）**，否则 Gatekeeper 仍可能拦截从未认证开发者处下载的 app。

### 签名

electron-builder 会使用钥匙串中可用的 Developer ID Application 证书。当前 `apps/desktop/electron-builder.yml` 中 `mac.identity: null` 表示**跳过签名**；要启用签名，请移除或改该字段：

```yaml
mac:
  identity: my-developer-id   # 或删除 identity 字段，让 electron-builder 自动选择
```

### 公证

公证需要 Apple ID 与应用专用密码，或 App Store Connect API Key，通过环境变量注入：

```bash
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="TEAMID"
pnpm build:clients:stable
```

electron-builder 会在打包 dmg/zip 后自动提交公证并 stapling。

> 完整公证参数见 electron-builder 官方文档 `mac.notarize` 一节。

## 产物验证

- **Windows**：右键 exe → 属性 → 数字签名，确认签名者与证书链。
- **macOS**：`codesign -dv --verbose=4 <app>` 查看签名信息；`spctl -a -vv <app>` 校验 Gatekeeper 是否放行。
- **SHA256**：无论是否签名，发布前都应核对 `SHA256SUMS.txt` 与产物一致（见 [release-template.md](./release-template.md)）。

## 发布清单

- [ ] 确认 Windows 证书路径与密码已注入（如需签名）
- [ ] 确认 macOS Developer ID 证书可用、公证参数已配置（如需签名）
- [ ] 三平台产物各打一次，核对 `SHA256SUMS.txt`
- [ ] 在 Release 页面标注签名状态（参见 release 模板“签名状态”小节）
