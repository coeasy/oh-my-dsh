# Changelog

> 简体中文版见 [CHANGELOG.zh-CN.md](CHANGELOG.zh-CN.md)。Simplified Chinese: [CHANGELOG.zh-CN.md](CHANGELOG.zh-CN.md).

## 0.1.0

Unofficial VS Code / Cursor VSIX and Electron shell around `dsh web`. Product version is **0.1.0** for every workspace package; do not bump a single app to 0.2.0.

- Bundled relocatable engine (flattened harness + Node) for the host OS. Packaged builds ignore ambient `DSH_RUNTIME=local` and launch `resources/runtime/dsh.cmd` (or `dsh` on POSIX).
- One-click pack is native to the host OS: `build-clients.cmd` / `build-clients.ps1` / `build-clients.sh`. Windows → NSIS + portable exe + zip; macOS → dmg + zip; Linux → AppImage + zip.
- Unpackaged desktop and VS Code F5 prefer `runtime/stage` then the gitignored clone. `DSH_BIN` still forces a specific binary.
- Spawn rejects a `.cmd` wrapper whose quoted `bin.js` is missing.
- `engine.lock.json` pins upstream `master` (no published tags). Fetch tries tag, then branch, then raw; a built clone is kept when update fails unless `DSH_FETCH_ENGINE_FORCE=1`.
- GitHub 403 / empty tags fall back to `git ls-remote --heads` (`master`/`main`) before the lock file.
- `install-clients.cmd` / `pnpm install:clients` installs the packed VSIX; `DSH_INSTALL=1` runs it after pack.
- Desktop: workspace folder picker, first-run API key setup, diagnostic export, update check, LAN phone bridge off until Connect Phone.
- Desktop system tray (Windows notification area) shows idle / starting / running / stopping / failed. Open Window, Restart, and Quit are on the tray menu.
- Close or Quit hides the window immediately, then tree-kills the engine (`taskkill /T` on Windows) using the recorded pid. Startup never runs PowerShell process scans, which blocked the portable exe from showing a window.
- Packaged desktop bundles the `qrcode` browser/SVG entry so Electron ESM no longer crashes on `Dynamic require of "fs"` at launch.
- Packaged `userData` is `%APPDATA%\dsh-client-desktop`, not the scoped npm name `@dsh/desktop`. Portable unpacks once into a stable `DeepSeek-Harness` folder.
- Desktop chrome hides the native menu and title-text bar (`titleBarStyle: hidden` + overlay caption buttons) so DeepSeek Harness fills the window.
- Relocatable launchers spawn `node` + `bin.js` directly so no `cmd.exe` console remains.
- CI verifies on Windows, macOS, and Ubuntu. Tagged `v0.1.0` packs all three OS artifact sets.
