# 变更日志（Changelog）

> 简体中文版；对应英文版见 [CHANGELOG.md](CHANGELOG.md)。English version: [CHANGELOG.md](CHANGELOG.md)。

## 0.1.0

围绕 `dsh web` 的非官方 VS Code / Cursor VSIX 与 Electron 壳层。**产品版本在所有 workspace 包中统一为 0.1.0**；不要将单个应用单独升到 0.2.0。

- 为宿主 OS 打包**可搬迁引擎**（扁平化 Harness + Node）。打包版忽略环境中的 `DSH_RUNTIME=local`，直接启动 `resources/runtime/dsh.cmd`（POSIX 上为 `dsh`）。
- 一键打包按宿主 OS 原生进行：`build-clients.cmd` / `build-clients.ps1` / `build-clients.sh`。Windows → NSIS + portable exe + zip；macOS → dmg + zip；Linux → AppImage + zip。
- 未打包的桌面端与 VS Code F5 优先 `runtime/stage`，其次 gitignored 克隆。`DSH_BIN` 仍可强制指定某个二进制。
- Spawn 会拒绝引用了缺失 `bin.js` 的 `.cmd` 包装器。
- `engine.lock.json` 钉死上游 `master`（无已发布 tag）。拉取依次尝试 tag → 分支 → raw；更新失败时保留已构建克隆，除非设置 `DSH_FETCH_ENGINE_FORCE=1`。
- GitHub 403 / 空 tag 时，在 lock 文件之前回退到 `git ls-remote --heads`（`master`/`main`）。
- `install-clients.cmd` / `pnpm install:clients` 安装打包好的 VSIX；`DSH_INSTALL=1` 在打包后自动执行。
- 桌面端：工作区文件夹选择、首启 API Key 设置、诊断导出、更新检查、LAN 手机桥（Connect Phone 前默认关闭）。
- 桌面系统托盘（Windows 通知区域）显示 idle / starting / running / stopping / failed。托盘菜单含 Open Window、Restart、Quit。
- 关闭或 Quit 立即隐藏窗口，然后按记录的 pid 整棵进程树收割（Windows 上为 `taskkill /T`）。启动从不运行 PowerShell 进程扫描——那会挡住 portable exe 显示窗口。
- 打包版桌面端内置 `qrcode` 浏览器/SVG 入口，避免 Electron ESM 启动时因 `Dynamic require of "fs"` 崩溃。
- 打包版 `userData` 为 `%APPDATA%\dsh-client-desktop`，而非 scoped npm 名 `@dsh/desktop`。便携版一次性解压到稳定的 `DeepSeek-Harness` 目录。
- 桌面 chrome 隐藏原生菜单与标题栏（`titleBarStyle: hidden` + overlay 标题按钮），让 DeepSeek Harness 铺满窗口。
- 可搬迁 launcher 直接 spawn `node` + `bin.js`，不残留 `cmd.exe` 控制台。
- CI 在 Windows、macOS、Ubuntu 三平台验证。打 tag `v0.1.0` 会打包三套 OS 产物。
