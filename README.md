# my-dsh 客户端（DeepSeek Harness 非官方封装）

Unofficial VS Code / Cursor extension and Electron desktop client for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). **Not published by, affiliated with, or endorsed by DeepSeek.**

Both apps share `@dsh/client-runtime` and the Cordis plugin `@dsh/plugin-embedded-client`. This tree does not fork the Harness kernel and **does not store** Harness sources. The default clone path `deepseek-harness/` is gitignored. Builds fetch [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (GitHub **stable**, else latest release). [`engine.lock.json`](engine.lock.json) is the pin / fallback.

## Improvement roadmap

See [docs/improvement/README.md](docs/improvement/README.md) for the phased improvement plan (engineering hygiene → quality hardening → feature expansion → long-term).

## One-click build and install

Each OS packs its own native desktop artifacts (Windows exe, macOS dmg, Linux AppImage). Do not cross-compile; the bundled Node binary is the host's.

| 操作 | Windows | macOS / Linux |
|---|---|---|
| 构建（stable） | `build-clients.cmd` | `./build-clients.sh` |
| 构建（latest release，含 rc） | `build-clients.cmd latest` | `./build-clients.sh latest` |
| 构建（lock 钉死） | `build-clients.cmd lock` | `./build-clients.sh lock` |
| 构建（钉死分支/tag） | `build-clients.cmd master` | `./build-clients.sh master` |
| 安装 VSIX 到 Cursor / VS Code | `install-clients.cmd` | `./install-clients.sh` |

`$env:DSH_INSTALL = '1'` 可在打包结束后直接安装 VSIX。`$env:DSH_INSTALL_DESKTOP = '1'` 会再启动 NSIS。

等价 pnpm（详见 [docs/one-click-clients.md](docs/one-click-clients.md)）：

```powershell
pnpm install
pnpm build:clients:stable
pnpm build:clients:latest
pnpm build:clients:lock
pnpm install:clients
```

Optional:

```powershell
$env:DSH_CLIENTS = "vscode,zip"          # 只打部分场景
$env:GITHUB_TOKEN = "..."                # 提高 GitHub API 额度
$env:DSH_SKIP_ENGINE_BUILD = "1"         # 克隆已构建时跳过 pnpm build
$env:DSH_ENGINE_REF = "master"           # 钉死某个分支或 tag
pnpm engine:resolve stable               # 只打印将使用的 ref
```

场景：`vscode`（Cursor/VS Code VSIX）；Windows `nsis` / `portable` / `zip`；macOS `dmg` / `zip`；Linux `appimage` / `zip`。产物在 `apps/vscode/*.vsix` 与 `apps/desktop/dist-release/`。双击 `my-dsh-*-portable.exe`（或安装 NSIS 后的桌面快捷方式）即可启动，不依赖 PATH 上的 `dsh`。

The clone is gitignored and **read-only**. The scripts never patch Harness sources.

## Download (third party)

After a GitHub Release exists, prefer:

1. `my-dsh-Setup-*.exe` (NSIS), or the `.zip` folder build
2. Verify `SHA256SUMS.txt`
3. First run: pick a **workspace folder**, paste `DEEPSEEK_API_KEY` (or put `.env` next to the exe)

Portable `*-portable.exe` unpacks once into a stable folder, then starts like the installed app. The `.zip` folder build is still a good USB copy.

Windows x64 only. Unsigned builds trigger SmartScreen until `CSC_LINK` is configured.

## Develop

See [docs/development.md](docs/development.md). Architecture: [docs/architecture.md](docs/architecture.md). Publishing a GitHub repo: [docs/publishing.md](docs/publishing.md).

```powershell
pnpm install
pnpm test
pnpm compile
pnpm verify          # hygiene + test + audit:layers + compile
```

## Layout

```
plugins/embedded-client   Cordis bundle (loopback + ready file)
packages/client-runtime   download / spawn / ready / shutdown
apps/vscode               VS Code / Cursor VSIX
apps/desktop              Electron shell
engine.lock.json          upstream Harness repository + fallback ref
deepseek-harness/         gitignored local clone (not in git)
```

Protocol: `dsh web` Host `/api` + WebSocket. `--patch` plugin `name` is a `file:` URL. Ready files stay under the system temp directory. `DSH_RUNTIME_URL` is `https:` only.

LAN phone bridge is off until **Connect Phone**. Same private Wi-Fi, QR pair, allowlisted RPC.

## License

MIT for this client pack. Bundled Harness / Node / Electron keep their own MIT licenses; see `NOTICE`.
