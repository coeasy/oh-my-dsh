# Release 说明模板（my-dsh 客户端）

> 维护者发布时：复制本模板到 GitHub Release body，替换 `<...>` 占位内容。
> 中文为主，可在 Release 页面追加英文摘要（英文标题建议保留，便于国际检索）。

---

# my-dsh v<0.1.1> — <一句话主题，如：稳定版 / 修复 X / 新增 Y>

**my-dsh** 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的非官方 VS Code / Cursor 扩展与 Electron 桌面客户端。
> 本客户端非 DeepSeek 官方出品，与 DeepSeek 无关联。MIT 许可，仅作学习与自用分发。

## 主要变更

### ✨ 新功能
- <描述一>（`#<PR>`）

### 🛠 改进
- <描述一>（`#<PR>`）

### 🐛 修复
- <描述一>（`#<PR>`）

> 完整逐条变更见 [CHANGELOG.md](./CHANGELOG.md)。由 Changesets 自动生成。

## 上游引擎版本

- Harness 仓库：`https://github.com/deepseek-ai/deepseek-harness`
- 本版本钉死：`ref = dsh-v0.1.0-rc.7`，`commit = 99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`（见 [`engine.lock.json`](./engine.lock.json)）

## 下载与校验

### 资源清单

| 平台 | 文件 | 用途 |
|---|---|---|
| Windows | `my-dsh-Setup-<v>.exe` | 安装版（NSIS） |
| Windows | `my-dsh-<v>-portable.exe` | 便携版 |
| Windows | `my-dsh-<v>-win.zip` | 绿色版（U 盘携带） |
| Windows | `my-dsh-vscode-<v>.vsix` | VS Code / Cursor 扩展 |
| macOS | `my-dsh-<v>.dmg` | 安装版 |
| macOS | `my-dsh-<v>-mac.zip` | 绿色版 |
| macOS | `my-dsh-vscode-<v>.vsix` | VS Code / Cursor 扩展 |
| Linux | `my-dsh-<v>.AppImage` | 便携版 |
| Linux | `my-dsh-<v>-linux.zip` | 绿色版 |
| Linux | `my-dsh-vscode-<v>.vsix` | VS Code / Cursor 扩展 |
| 全部 | `SHA256SUMS.txt` | 校验清单 |

### 校验哈希

下载 `SHA256SUMS.txt` 后校验对应文件：

**Windows（PowerShell）**
```powershell
Get-FileHash .\my-dsh-Setup-<v>.exe -Algorithm SHA256
```

**macOS / Linux**
```bash
shasum -a 256 my-dsh-<v>.dmg
```

对比输出与 `SHA256SUMS.txt` 中的值，不一致请勿运行并提交 Issue。

## 安装

### VS Code / Cursor 扩展
`code --install-extension my-dsh-vscode-<v>.vsix`（Cursor 用 `cursor --install-extension`），或菜单 → 扩展 → ... → 从 VSIX 安装。

### 桌面端
- Windows：运行 `my-dsh-Setup-<v>.exe`（或双击 `my-dsh-<v>-portable.exe`）
- macOS：打开 `my-dsh-<v>.dmg` 拖入 Applications
- Linux：运行 `my-dsh-<v>.AppImage`

### 首次运行
1. 选择**工作区文件夹**
2. 粘贴 `DEEPSEEK_API_KEY`（或把 `.env` 放在可执行文件旁）
3. 手机桥接默认关闭，需要时在托盘 → Connect Phone 开启

### 签名状态（重要）
> 当前 Windows/macOS 产物**未签名**。Windows 可能弹出 SmartScreen"Windows 已保护你的电脑"，点击"更多信息 → 仍要运行"；macOS 需在"系统设置 → 隐私与安全性 → 仍要打开"。我们正在推进代码签名（见 `docs/signing.md`），届时可消除该提示。

## 升级 / 降级
- 升级：直接运行新版安装包即可覆盖（便携版请替换整个解压目录）
- 降级：卸载后安装旧版；`desktop-settings.json` 中的用户配置跨版本保留

## 已知问题与兼容性
- 仅支持 Windows x64 / macOS（Apple Silicon 与 Intel）/ Linux x64
- <可选：列出已知问题，如 auto-update 暂未启用、需要手动检查更新>

## 反馈
- 提交 Issue：https://github.com/coeasy/oh-my-dsh/issues
- 源码与构建：见仓库 `README.md` / `docs/`

## 许可证
客户端包为 **MIT**；内置 Harness / Node / Electron 保留各自许可，见 `NOTICE`。

---
*生成说明：本模板人工维护；建议每次发布在 body 中附上 `SHA256SUMS.txt` 对应的校验值或链接。*
