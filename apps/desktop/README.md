# DeepSeek Harness Desktop (unofficial)

Electron window around `dsh web`. Release builds provide two editions:

- Offline (default): ships Node, the flattened Harness, and the Cordis plugin. A third-party PC does not install Node or `dsh`.
- Online/slim: omits the engine payload and uses a current `dsh` from PATH, or the absolute launcher in `DSH_BIN`.

This client is unofficial and is not published by DeepSeek.

```powershell
pnpm compile
pnpm --dir apps/desktop start
```

- Packaged: extraResources `runtime/` launcher. Ambient `DSH_RUNTIME=local` is ignored so PATH `dsh` cannot hijack the installer.
- Packaged online/slim: `runtime.json` explicitly selects the system CLI; no `runtime/node` or `runtime/harness` is allowed in the artifact.
- Unpackaged: `runtime/stage` if present, else gitignored `deepseek-harness/` via `runtime/dev/dsh.cmd`. `DSH_BIN` still forces a specific binary.
- First run asks for a workspace folder and an API key (stored under `%APPDATA%\dsh-client-desktop\harness\.env`). File → Open Workspace changes the folder later.
- You can also put `DEEPSEEK_API_KEY` in `.env` next to the file you double-clicked.
- LAN phone: Harness → Connect Phone (off by default). Stop Phone Bridge tears it down.
- The window has no File/Edit menu bar or title-text caption. DeepSeek Harness fills the client; native min/max/close stay on the overlay.
- The notification-area tray shows whether Harness is idle, starting, running, stopping, or failed. Open Window / Restart / Quit are on the tray menu.
- Closing the window (Windows/Linux) or choosing Quit stops every Harness process immediately (`taskkill /T`). No leftover `node` / `cmd` / `conhost` should remain.
- File → Export Diagnostics writes a redacted report. File → Check for Updates needs `DSH_GITHUB_REPO=owner/repo`.

```powershell
pnpm pack:desktop
pnpm pack:desktop:online
pnpm pack:desktop:dual
```

Artifacts in `apps/desktop/dist-release/` (the slim variants include `online` in the filename):

- `my-dsh-Setup-*.exe` / `my-dsh-online-Setup-*.exe` — NSIS
- `my-dsh-*-portable.exe` / `my-dsh-online-*-portable.exe` — one-file portable builds
- `*.zip` — folder copy (also good for USB)
- `SHA256SUMS.txt`
