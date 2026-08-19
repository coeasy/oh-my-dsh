# my-dsh 客户端（DeepSeek Harness 非官方封装）

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的非官方 VS Code / Cursor 扩展与 Electron 桌面客户端。**非 DeepSeek 官方出品，与 DeepSeek 无任何关联或背书。**

> 英文版见 [README.md](README.md)。

两个客户端共享 `@dsh/client-runtime` 与 Cordis 插件 `@dsh/plugin-embedded-client`。本仓库**不 fork Harness 内核**、**不存储 Harness 源码**。默认克隆目录 `deepseek-harness/` 已被 gitignore。构建时从 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 拉取（GitHub **stable**，否则最新 release）。[`engine.lock.json`](engine.lock.json) 为钉死 / 兜底引用。

## 上游引擎引用方式

本仓库**不 vendoring 也不 fork** [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 内核，引用在 [`engine.lock.json`](engine.lock.json) 中钉死：

```json
{
  "repository": "https://github.com/deepseek-ai/deepseek-harness.git",
  "ref": "dsh-v0.1.0-rc.7",
  "pinnedCommit": "99f6f02fecdb7dff40c3fbc9470f5907c29f74ca"
}
```

构建把钉死的 ref 拉取到 gitignored 的 `deepseek-harness/` 克隆（`pnpm fetch:engine`，由 `build-clients` 自动执行）。当 GitHub releases / `git ls-remote` 不可达时，lock 为最终兜底。尝试其他上游版本：

```powershell
$env:DSH_ENGINE_REF = "master"        # 或任意 tag
pnpm fetch:engine
```

**刻意不使用 git submodule**：克隆是只读构建输入，按宿主 OS 拉取，永不回写提交。

## 改进路线图

分阶段改进计划（工程卫生 → 质量加固 → 功能扩展 → 长期方向）见 [docs/improvement/README.md](docs/improvement/README.md)。

## 一键构建与安装

每个 OS 打包各自的原生桌面产物（Windows exe、macOS dmg、Linux AppImage）。禁止交叉编译；内置 Node 二进制为宿主所属。

| 操作 | Windows | macOS / Linux |
|---|---|---|
| **本地一键构建（推荐）** | `build-local.cmd` | `./build-local.sh` |
| 构建（stable） | `build-clients.cmd` | `./build-clients.sh` |
| 构建（latest release，含 rc） | `build-clients.cmd latest` | `./build-clients.sh latest` |
| 构建（lock 钉死） | `build-clients.cmd lock` | `./build-clients.sh lock` |
| 构建（钉死分支/tag） | `build-clients.cmd master` | `./build-clients.sh master` |
| 安装 VSIX 到 Cursor / VS Code | `install-clients.cmd` | `./install-clients.sh` |

`$env:DSH_INSTALL = '1'` 可在打包结束后直接安装 VSIX。`$env:DSH_INSTALL_DESKTOP = '1'` 会再启动 NSIS。

`build-local.*` 是慢速网络环境下的推荐捷径：它会预配置 GitHub 克隆代理（`ghfast.top`）、npm 镜像源（`npmmirror`）与 Electron 镜像，默认构建钉死的 `lock` 通道。可通过 `DSH_GH_PROXY=0`、`DSH_REGISTRY`、`DSH_ELECTRON_MIRROR` 关闭或覆盖。

等价 pnpm（详见 [docs/one-click-clients.md](docs/one-click-clients.md)）：

```powershell
pnpm install
pnpm build:clients:stable
pnpm build:clients:latest
pnpm build:clients:lock
pnpm install:clients
```

可选：

```powershell
$env:DSH_CLIENTS = "vscode,zip"          # 只打部分场景
$env:GITHUB_TOKEN = "..."                # 提高 GitHub API 额度
$env:DSH_SKIP_ENGINE_BUILD = "1"         # 克隆已构建时跳过 pnpm build
$env:DSH_ENGINE_REF = "master"           # 钉死某个分支或 tag
pnpm engine:resolve stable               # 只打印将使用的 ref
```

场景：`vscode`（Cursor/VS Code VSIX）；Windows `nsis` / `portable` / `zip`；macOS `dmg` / `zip`；Linux `appimage` / `zip`。产物在 `apps/vscode/*.vsix` 与 `apps/desktop/dist-release/`。双击 `my-dsh-*-portable.exe`（或安装 NSIS 后的桌面快捷方式）即可启动，不依赖 PATH 上的 `dsh`。

克隆被 gitignore 且**只读**。脚本从不修改 Harness 源码。

## 下载（第三方分发）

GitHub Release 发布后，优先：

1. `my-dsh-Setup-*.exe`（NSIS），或 `.zip` 文件夹构建
2. 校验 `SHA256SUMS.txt`
3. 首次运行：选择**工作区文件夹**，粘贴 `DEEPSEEK_API_KEY`（或把 `.env` 放在 exe 旁）

便携版 `*-portable.exe` 解压一次到稳定目录，然后与安装版一样启动。`.zip` 文件夹构建适合 U 盘携带。

仅 Windows x64。未签名构建会触发 SmartScreen，直到配置 `CSC_LINK`。

## 开发

见 [docs/development.md](docs/development.md)。架构：[docs/architecture.md](docs/architecture.md)。发布 GitHub 仓库：[docs/publishing.md](docs/publishing.md)。

```powershell
pnpm install
pnpm test
pnpm compile
pnpm verify          # hygiene + test + audit:layers + compile
```

## 目录布局

```
plugins/embedded-client   Cordis bundle (loopback + ready file)
packages/client-runtime   download / spawn / ready / shutdown
apps/vscode               VS Code / Cursor VSIX
apps/desktop              Electron shell
engine.lock.json          upstream Harness repository + fallback ref
deepseek-harness/         gitignored local clone (not in git)
```

协议：`dsh web` Host `/api` + WebSocket。`--patch` 插件的 `name` 是 `file:` URL。ready 文件留在系统临时目录。`DSH_RUNTIME_URL` 仅支持 `https:`。

LAN 手机桥默认关闭，直到 **Connect Phone**。同一私网 Wi-Fi、二维码配对、白名单 RPC。

## 国际化（i18n）

客户端壳层（托盘、设置、启动、手机桥接）与文档为中英双语，自动跟随系统语言。详见 [docs/i18n.md](docs/i18n.md)。English: [README.md](README.md)。

## 许可证

客户端包为 MIT。内置 Harness / Node / Electron 保留各自 MIT 许可证；见 `NOTICE`。
