# 一键构建多场景客户端

从 GitHub 拉取 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 的最新稳定（或指定）版本，在本机构建引擎，并打包 VS Code / Cursor VSIX 与当前操作系统的 Electron 安装包。不修改 Harness 内核源码。克隆目录默认是仓库根下的 `deepseek-harness/`，已被 gitignore。

每个操作系统只打包自己的桌面产物：Windows 产出 exe，macOS 产出 dmg，Linux 产出 AppImage。捆绑的 Node 来自本机 `process.execPath`，不要从另一台机器交叉编译。

## 一键入口

Windows：

```powershell
tools\build-clients.cmd
tools\install-clients.cmd
```

macOS / Linux：

```bash
./tools/build-clients.sh
./tools/install-clients.sh
```

默认通道是 **stable**：GitHub 最新非预发布 Release；若当前只有 rc，则用最新 Release。需要本机已安装 Node.js 22+ 与 pnpm 10。

```powershell
.\tools\build-clients.cmd latest   # 含 rc 的最新 GitHub Release
.\tools\build-clients.cmd lock     # 只用 engine.lock.json
.\tools\build-clients.cmd master   # 钉死某个 git 分支或 tag
$env:DSH_INSTALL = '1'
.\tools\build-clients.cmd          # 打包后安装 VSIX
$env:DSH_SKIP_ENGINE_BUILD = '1'    # 克隆已构建时跳过上游 pnpm build
$env:DSH_CLIENTS = 'portable'       # 只要可双击的 portable exe
```

等价 pnpm：

```powershell
pnpm install
pnpm build:clients:stable
pnpm build:clients:latest
pnpm build:clients:lock
pnpm install:clients
```

## 解析顺序

1. `DSH_ENGINE_REF`（或脚本参数里的 tag / 分支）
2. GitHub Releases API（`GITHUB_TOKEN` 或 `GH_TOKEN` 提高额度）
3. `git ls-remote --tags`
4. `git ls-remote --heads`（`master` / `main`；上游尚未打 tag 时走这里）
5. `engine.lock.json`（当前 pin：`master`）

克隆路径：`DSH_ENGINE_ROOT` 或默认 `<repo>/deepseek-harness`（见 `scripts/engine-root.mjs`）。

## 场景裁剪

默认场景随本机 OS 变化。在错误的 OS 上请求 `nsis` / `dmg` / `appimage` 会直接失败。

```powershell
$env:DSH_CLIENTS = "vscode,zip"
.\tools\build-clients.cmd
```

| 场景 | 本机 OS | 产物 |
|---|---|---|
| `vscode` | 任意 | `apps/vscode/*.vsix` |
| `nsis` | Windows | `apps/desktop/dist-release/DeepSeek-Harness-Setup-*.exe` |
| `portable` | Windows | `apps/desktop/dist-release/DeepSeek-Harness-*-portable.exe` |
| `zip` | 当前 OS | `DeepSeek-Harness-*-win.zip` / `-mac.zip` / `-linux.zip` |
| `dmg` | macOS | `DeepSeek-Harness-*-mac.dmg` |
| `appimage` | Linux | `DeepSeek-Harness-*-linux.AppImage` |

## 安装到本机

`tools\install-clients.cmd` 或 `./tools/install-clients.sh` 把最新 VSIX 装进 PATH 上的 `cursor` 和/或 `code`。桌面安装包只打印路径；设 `DSH_INSTALL_DESKTOP=1` 才会启动 NSIS。

## 第三方使用产物

双击 portable exe、NSIS 安装后的快捷方式、macOS dmg 或 Linux AppImage 即可启动捆绑的 `dsh web`，不必再装 Node / 全局 `dsh`。安装包忽略本机 `DSH_RUNTIME=local`，不会去 PATH 上找旧工作区的 `dsh`。首次运行选择工作区并填写 `DEEPSEEK_API_KEY`。这是非官方客户端，不是 DeepSeek 发布。
