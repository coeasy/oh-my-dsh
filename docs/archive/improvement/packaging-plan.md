# 客户端打包方案与构建结果

> 更新：2026-08-18

## 方案选择

本项目采用 **Electron + electron-builder**（维持现状），理由：
- 重引擎轻壳：安装包大头是引擎 payload，换 Tauri 省体积收益有限，却要付出三平台 WebView 兼容回归 + 主进程重写成本。
- 上游 SPA 用统一 Chromium 保证三平台渲染一致。
- 现有托盘/进程收割/手机桥/87+ 测试全基于 Electron，迁移即重写。

明确不做：Tauri、三平台原生壳。

## 分发形态（Windows，当前已产出）

| 产物 | 大小 | 用途 |
|---|---|---|
| `DeepSeek-Harness-Setup-0.1.0.exe` | 202MB | NSIS 安装包（一健安装到 Program Files） |
| `DeepSeek-Harness-0.1.0-portable.exe` | 202MB | **便携独立 exe**：解压即用、不写注册表，直接双击运行 |
| `DeepSeek-Harness-0.1.0-win.zip` | 384MB | 文件夹 zip（解压到任意目录运行） |
| `SHA256SUMS.txt` | — | 三产物校验和 |

macOS（dmg/zip）与 Linux（AppImage/zip）由对应宿主 OS 各自打包（electron-builder 原生，禁止交叉编译）。

## 构建命令

```powershell
pnpm install                 # 首次：安装 electron / electron-builder（含二进制下载）
pnpm pack:desktop            # 编译 + 打包当前 OS（Windows → NSIS/portable/zip）
pnpm pack:vscode             # VS Code / Cursor VSIX
pnpm build:clients           # 一键全客户端（见 docs/one-click-clients.md）
```

## 本次修复的打包问题

1. **afterPack 钩子路径**：electron-builder v26 要求钩子文件在项目目录内。原配置 `afterPack: ../../scripts/electron-after-pack.cjs` 解析到工作区根之外被拒。
   修复：新增 `apps/desktop/after-pack.cjs` 转发到仓库根实现，`electron-builder.yml` 改为 `afterPack: after-pack.cjs`。
2. **白屏根因（flatten 漏包）**：见 [white-screen-fix.md](white-screen-fix.md)。

## 后续可选：在线安装包（瘦身）

按计划第①形态，可加 `online` 场景：壳只带下载器，首启从 `DSH_RUNTIME_URL` 下载引擎到 `engine-cache/<version>/`，复用已实现的 `engine-updater.ts` 校验/激活/回滚。可在 `client-scenarios.mjs` 增加场景并让 electron-builder.yml 条件排除 payload。

## 验证

- `pnpm verify` 全通过（hygiene + 156 测试 + audit:layers + compile）
- `pnpm pack:desktop` 产出 NSIS/portable/zip 三产物，`win-unpacked` 内含完整可搬迁 payload（`dsh.cmd`/`harness`/`node.exe`/`origin.json`）
