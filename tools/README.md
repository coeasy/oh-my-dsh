# Platform entry points

Human-facing one-click wrappers for building and installing clients on
Windows, macOS, and Linux. They are deliberately thin: all logic lives in
`scripts/*.mjs` so every platform behaves identically.

## Build clients

```
Windows:  build-clients.cmd          macOS/Linux:  ./build-clients.sh
PowerShell: .\build-clients.ps1
```

- Default channel is `stable` (newest non-prerelease release). Pass
  `latest` (including prereleases), `lock` (engine.lock.json), or an explicit
  git ref/tag/commit as the first argument.
- The engine is fetched, built, and pinned automatically — run
  `pnpm engine:update` (or `engine:update:stable`) to fast-forward
  `engine.lock.json` to the newest release without building clients.
- Incremental / fast local builds: set `DSH_SKIP_ENGINE_BUILD=1`,
  `DSH_SKIP_FETCH=1`, and/or `DSH_SKIP_PNPM_INSTALL=1`.
- Install the packed clients in the same run with `DSH_INSTALL=1`.

Artifacts land in `apps/vscode/*.vsix` and `apps/desktop/dist-release/`
(NSIS installer + portable exe + zip on Windows; dmg + zip on macOS;
AppImage + zip on Linux).

## Install clients

```
Windows:  install-clients.cmd        macOS/Linux:  ./install-clients.sh
PowerShell: .\install-clients.ps1
```

Installs the newest VSIX into Cursor and/or VS Code when their CLI is on
PATH, and prints desktop artifact paths. Set `DSH_INSTALL_DESKTOP=1` to also
launch the desktop installer (NSIS / `open` dmg / AppImage).

## CI and development

Use the package scripts (`pnpm build:clients:*`, `pnpm pack:vscode`,
`pnpm pack:desktop`) when a programmatic entry point is preferred. All env
knobs documented in `scripts/build-clients.mjs` apply to every wrapper.
