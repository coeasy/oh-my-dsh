# DeepSeek Harness Desktop (unofficial)

Electron window around `dsh web`. Packaged builds ship Node, the flattened Harness, and the Cordis plugin. A third-party PC does not install Node or `dsh`.

This client is unofficial and is not published by DeepSeek.

```powershell
pnpm compile
pnpm --dir apps/desktop start
```

- Packaged: extraResources `runtime/` launcher. Ambient `DSH_RUNTIME=local` is ignored so PATH `dsh` cannot hijack the installer.
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
```

Artifacts in `apps/desktop/dist-release/`:

- `DeepSeek-Harness-Setup-*.exe` — NSIS
- `DeepSeek-Harness-*-portable.exe` — one-file; unpacks once into a stable folder, then starts immediately
- `*.zip` — folder copy (also good for USB)
- `SHA256SUMS.txt`
