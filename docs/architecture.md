# 架构：模块边界

外壳只负责启动 `dsh web` 并加载 loopback URL。内核源码不在本仓库；构建时从 GitHub 克隆到 gitignored 的 `deepseek-harness/`。

## 分层

```
apps/vscode  ──┐
               ├── @dsh/client-runtime  ──spawn──►  dsh web + embedded-client patch
apps/desktop ──┘                                              │
                                                              ▼
                                                    Cordis: dsh-base
                                                          + dsh-web-app
                                                          + @dsh/plugin-embedded-client
                                                              │
                                                              ▼
                                                    http://127.0.0.1:<port>
                                                              │
                                                    上游 Web SPA
```

## 依赖方向（禁止反向）

| 包 | 可以依赖 | 禁止依赖 |
|---|---|---|
| `@dsh/plugin-embedded-client` | Cordis `ctx`（duck-typed）、Node fs | vscode、electron、client-runtime、apps/* |
| `@dsh/client-runtime` | Node child_process / fs / http | vscode、electron、cordis、plugin-embedded-client 运行时 |
| `apps/vscode` | vscode、client-runtime | electron、cordis |
| `apps/desktop` | electron、client-runtime | vscode、cordis |

`client-runtime` 运行时生成 `--patch` overlay（`buildPatchYaml`），把插件 `name` 写成 `file:` URL；静态 `plugins/embedded-client/cordis.patch.yml` 只是模板。runtime 不 import 插件源码，因此没有循环依赖。

## 进程

1. 外壳调用 `launchHost({ workspaceCwd, mode })`
2. runtime 解析 `dsh`（local PATH / bundled 安装包内引擎 / download 缓存）
3. 创建临时 ready 文件；生成 `--patch` overlay；spawn `dsh web --patch <generated.yml> --host 127.0.0.1 --port 0`
4. 插件在 `webServer` 就绪后写 `{ url, pid, port, host }`
5. 外壳 Webview / BrowserWindow 加载 `url`（runtime 已 `assertLoopbackUrl`）
6. `stop()`：Windows 先 `taskkill /T /F`（父进程仍在时杀掉整棵树），再按 bundled `node` 路径收割残留；POSIX 仍是 stdin EOF → SIGTERM → SIGKILL。可搬迁 launcher 直接 spawn `node` + `bin.js`，不经过 `cmd.exe`。桌面退出时先关窗口再杀引擎。

`assertLoopbackUrl` 只接受 `http://127.0.0.1:<port>`。`localhost`、`0.0.0.0`、`::1`、https 一律失败。插件 `buildReadyPayload` 同样拒绝非 127.0.0.1。

## 引擎获取

默认通道是 GitHub **stable**（最新非预发布；若只有 rc 则用最新 Release）。没有 Release / tag 时回退 `git ls-remote --heads`（`master`/`main`），再回退 `engine.lock.json`。克隆目录由 `scripts/engine-root.mjs` 决定，默认 `<repo>/deepseek-harness`，可用 `DSH_ENGINE_ROOT` 覆盖。脚本从不修改克隆内的源码。

未打包的桌面端和 VS Code F5 优先用 `runtime/stage`，其次用克隆里的 `apps/cli/lib/bin.js`（写入 `runtime/dev/dsh.cmd`）。安装包始终用 `resources/runtime` 里的可搬迁 launcher，忽略本机 `DSH_RUNTIME=local`。启动前会拒绝指向缺失 `bin.js` 的过期 `.cmd`。

## 环境变量

| 变量 | 含义 |
|---|---|
| `DSH_RUNTIME` | `local`（PATH `dsh`）、`bundled`（安装包 / 仓库克隆）或 `download`。未打包且未设置时优先 stage/clone |
| `DSH_BIN` | 覆盖本机 dsh 可执行文件 |
| `DSH_RUNTIME_URL` | 发布下载基址（缺省则 download 模式 fail loud） |
| `DSH_RUNTIME_CACHE` | 下载缓存目录，默认 `~/.dsh-client/runtime` |
| `DSH_READY_FILE` | 由 runtime 注入给子进程 |
| `DSH_WORKSPACE_CWD` | 工作区根，由 runtime 注入 |
| `DSH_ENGINE_ROOT` | 覆盖上游克隆目录 |
| `DSH_ENGINE_REF` | 钉死某个 Harness git tag 或分支 |
| `DSH_INSTALL` | 打包完成后安装 VSIX |

安装后的 Electron 把 `embedded-client.js`、`runtime/node.exe`、`runtime/dsh.cmd` 和可搬迁的 `runtime/harness/` 放到 `resources/`（asar 外）。`dsh.cmd` 只用 `%~dp0` 相对路径。VSIX 解压后插件与 `extension.js` 同目录。
