# my-dsh v0.1.0 — 首个正式发布

**my-dsh** 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的非官方 VS Code / Cursor 扩展与 Electron 桌面客户端。
> 本客户端非 DeepSeek 官方出品，与 DeepSeek 无关联。MIT 许可，仅作学习与自用分发。

## 主要变更

### ✨ 新功能
- VS Code / Cursor 扩展与 Electron 桌面客户端，一键拉起 DeepSeek Harness Web 界面（loopback 直连）
- 跨平台一键打包：Windows（NSIS / portable / zip）、macOS（dmg / zip）、Linux（AppImage / zip）
- 可搬迁运行时：打包后的可执行文件仅依赖相对路径，双击即用，无需安装 `dsh`
- 上游引擎自动获取与解析：GitHub stable → latest release → 钉死 `engine.lock.json` 兜底
- 进程生命周期管理：退出时整棵进程树收割，无 `cmd.exe` 控制台残留
- 安全基线：仅接受 `http://127.0.0.1:<port>` loopback 地址，拒绝 external 访问
- 桌面端：系统托盘、工作区选择、首启 API Key 设置、诊断导出、引擎更新检查、LAN 手机桥（默认关闭）
- 壳层国际化：托盘 / 设置 / 启动 / 手机桥接页中英双语，随系统语言自动切换

### 🛠 工程化
- 三平台 CI 门禁（verify：hygiene + typecheck + lint + format + 测试 + 依赖分层审计 + 编译）
- Changesets 全自动发版闭环（合并即开版本 PR，合并即打 tag 触发发布）
- GitHub Release 三平台打包 + `SHA256SUMS.txt` 校验清单
- 156+ 单元测试，`pnpm verify` 全绿

### 🐛 修复
- 首个版本，暂无修复记录

> 完整逐条变更见 [CHANGELOG.md](../CHANGELOG.md)。

## 上游引擎版本

- Harness 仓库：`https://github.com/deepseek-ai/deepseek-harness`
- 本版本钉死：`ref = dsh-v0.1.0-rc.7`，`commit = 99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`（见 [`engine.lock.json`](../engine.lock.json)）

## 下载与校验

### 资源清单

| 平台 | 文件 | 用途 |
|---|---|---|
| Windows | `my-dsh-Setup-0.1.0.exe` | 安装版（NSIS） |
| Windows | `my-dsh-0.1.0-portable.exe` | 便携版 |
| Windows | `my-dsh-0.1.0-win.zip` | 绿色版（U 盘携带） |
| Windows | `my-dsh-vscode-0.1.0.vsix` | VS Code / Cursor 扩展 |
| macOS | `my-dsh-0.1.0-mac.dmg` | 安装版 |
| macOS | `my-dsh-0.1.0-mac.zip` | 绿色版 |
| macOS | `my-dsh-vscode-0.1.0.vsix` | VS Code / Cursor 扩展 |
| Linux | `my-dsh-0.1.0-linux.AppImage` | 便携版 |
| Linux | `my-dsh-0.1.0-linux.zip` | 绿色版 |
| Linux | `my-dsh-vscode-0.1.0.vsix` | VS Code / Cursor 扩展 |
| 全部 | `SHA256SUMS.txt` | 校验清单 |

### 校验哈希

下载 `SHA256SUMS.txt` 后校验对应文件：

**Windows（PowerShell）**
```powershell
Get-FileHash .\my-dsh-Setup-0.1.0.exe -Algorithm SHA256
```

**macOS / Linux**
```bash
shasum -a 256 my-dsh-0.1.0-mac.dmg
```

对比输出与 `SHA256SUMS.txt` 中的值，不一致请勿运行并提交 Issue。

## 安装

### VS Code / Cursor 扩展
```bash
code --install-extension my-dsh-vscode-0.1.0.vsix
# Cursor 用：cursor --install-extension my-dsh-vscode-0.1.0.vsix
```
或菜单 → 扩展 → ⋯ → 从 VSIX 安装。

### 桌面端
- **Windows**：运行 `my-dsh-Setup-0.1.0.exe`（或双击 `my-dsh-0.1.0-portable.exe`）
- **macOS**：打开 `my-dsh-0.1.0-mac.dmg` 拖入 Applications
- **Linux**：运行 `my-dsh-0.1.0-linux.AppImage`

### 首次运行
1. 选择**工作区文件夹**
2. 粘贴 `DEEPSEEK_API_KEY`（或把 `.env` 放在可执行文件旁）
3. 手机桥接默认关闭，需要时在托盘 → Connect Phone 开启

### 签名状态（重要）
> 当前 Windows / macOS 产物**未签名**。Windows 可能弹出 SmartScreen"Windows 已保护你的电脑"，点击"更多信息 → 仍要运行"；macOS 需在"系统设置 → 隐私与安全性 → 仍要打开"。我们正在推进代码签名（见 `docs/signing.md`），届时可消除该提示。

## 升级 / 降级
- 升级：直接运行新版安装包覆盖即可（便携版请替换整个解压目录）
- 降级：卸载后安装旧版；`desktop-settings.json` 中的用户配置跨版本保留

## 已知问题与兼容性
- 仅支持 Windows x64 / macOS（Apple Silicon 与 Intel）/ Linux x64
- 桌面端暂未启用自动更新（electron-updater），请手动在托盘 → Check for Updates 检查新版本
- 首次运行需联网获取 Harness 引擎

## 反馈
- 提交 Issue：https://github.com/coeasy/oh-my-dsh/issues
- 源码与构建：见仓库 `README.md` / `docs/`

## 许可证
客户端包为 **MIT**；内置 Harness / Node / Electron 保留各自许可，见 `NOTICE`。

---
*本说明由维护者按模板预填；发布前请核对 `SHA256SUMS.txt` 与产物确实一致。*
