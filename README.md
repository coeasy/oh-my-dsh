# my-dsh — unofficial DeepSeek Harness client pack

Unofficial VS Code / Cursor extension and Electron desktop client for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). **Not published by, affiliated with, or endorsed by DeepSeek.**

Both apps share `@dsh/client-runtime` and the Cordis plugin `@dsh/plugin-embedded-client`. This tree does not fork the Harness kernel and **does not store** Harness sources. The default clone path `deepseek-harness/` is gitignored. Builds fetch [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (GitHub **stable**, else latest release). [`engine.lock.json`](engine.lock.json) is the pin / fallback.

## Upstream engine (how DeepSeek Harness is referenced)

This repo does **not** vendor or fork the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) kernel. The reference is pinned in [`engine.lock.json`](engine.lock.json):

```json
{
  "repository": "https://github.com/deepseek-ai/deepseek-harness.git",
  "ref": "dsh-v0.1.0-rc.8",
  "pinnedCommit": "99f6f02fecdb7dff40c3fbc9470f5907c29f74ca"
}
```

Builds fetch the pinned ref into the gitignored `deepseek-harness/` clone (`pnpm fetch:engine`, run automatically by `build-clients`). The lock is the final fallback when GitHub releases / `git ls-remote` cannot be reached. To try another upstream version:

```powershell
$env:DSH_ENGINE_REF = "master"        # or any tag
pnpm fetch:engine
```

A git submodule was deliberately **not** used: the clone is read-only build input, fetched per-host-OS, and never committed back.

## Improvement roadmap

See [docs/roadmap.md](docs/roadmap.md) for the current improvement roadmap.

## One-click build and install

Each OS packs its own native desktop artifacts (Windows exe, macOS dmg, Linux AppImage). Do not cross-compile; the bundled Node binary is the host's.

| Action | Windows | macOS / Linux |
|---|---|---|
| Build (stable) | `tools\build-clients.cmd` | `./tools/build-clients.sh` |
| Build (latest release, incl. rc) | `tools\build-clients.cmd latest` | `./tools/build-clients.sh latest` |
| Build (pinned lock) | `tools\build-clients.cmd lock` | `./tools/build-clients.sh lock` |
| Build (pinned branch / tag) | `tools\build-clients.cmd master` | `./tools/build-clients.sh master` |
| Install VSIX into Cursor / VS Code | `tools\install-clients.cmd` | `./tools/install-clients.sh` |

`$env:DSH_INSTALL = '1'` installs the packed VSIX right after packing; `$env:DSH_INSTALL_DESKTOP = '1'` also launches the NSIS installer.

For reproducible local builds, use the pinned channel: `tools\build-clients.cmd lock` or `./tools/build-clients.sh lock`. Package-manager and Electron download sources remain controlled by the standard pnpm configuration.

Equivalent pnpm commands (see [docs/one-click-clients.md](docs/one-click-clients.md)):

```powershell
pnpm install
pnpm build:clients:stable
pnpm build:clients:latest
pnpm build:clients:lock
pnpm install:clients
```

Optional:

```powershell
$env:DSH_CLIENTS = "vscode,zip"          # pack only some scenarios
$env:GITHUB_TOKEN = "..."                # raise GitHub API rate limits
$env:DSH_SKIP_ENGINE_BUILD = "1"         # skip pnpm build when the clone is already built
$env:DSH_ENGINE_REF = "master"           # pin a branch or tag
pnpm engine:resolve stable               # only print the ref that would be used
```

Scenarios: `vscode` (Cursor/VS Code VSIX); Windows `nsis` / `portable` / `zip`; macOS `dmg` / `zip`; Linux `appimage` / `zip`. Artifacts land in `apps/vscode/*.vsix` and `apps/desktop/dist-release/`. Double-click `my-dsh-*-portable.exe` (or the desktop shortcut from the NSIS install) to launch — no `dsh` on PATH is needed.

The clone is gitignored and **read-only**. The scripts never patch Harness sources.

## Download (third party)

After a GitHub Release exists, prefer:

1. `my-dsh-Setup-*.exe` (NSIS), or the `.zip` folder build
2. Verify `SHA256SUMS.txt`
3. First run: pick a **workspace folder**, paste `DEEPSEEK_API_KEY` (or put `.env` next to the exe)

Portable `*-portable.exe` unpacks once into a stable folder, then starts like the installed app. The `.zip` folder build is still a good USB copy.

Windows x64 only. Unsigned builds trigger SmartScreen until `CSC_LINK` is configured.

## Develop

See [CONTRIBUTING.md](CONTRIBUTING.md). Architecture: [docs/architecture.md](docs/architecture.md). Publishing a GitHub repo: [docs/publishing.md](docs/publishing.md).

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

## Internationalization (i18n)

The client shell (tray, setup, splash, phone bridge) and docs are bilingual (English / 简体中文) and follow the host OS language automatically. See [docs/i18n.md](docs/i18n.md). 简体中文版: [README.zh-CN.md](README.zh-CN.md).

## License

MIT for this client pack. Bundled Harness / Node / Electron keep their own MIT licenses; see `NOTICE`.
