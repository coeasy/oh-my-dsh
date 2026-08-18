# AGENTS.md — dsh-client-pack

Unofficial VS Code / Cursor + Electron clients for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). This tree does not fork the kernel.

## Engine clone

- Default clone path: `deepseek-harness/` at the repository root.
- That directory is gitignored. Fetch it with `pnpm fetch:engine` or `.\build-clients.cmd`.
- Never edit files inside the clone. `DSH_ENGINE_ROOT` may override the path.
- Default channel is GitHub **stable** (non-prerelease; if none exist, latest release). No tags → `git ls-remote --heads` (`master`/`main`) → `engine.lock.json` (`master`).

## Commands

```powershell
pnpm install
pnpm test
pnpm compile
pnpm verify
.\build-clients.cmd              # Windows: VSIX + NSIS/portable/zip
./build-clients.sh               # macOS/Linux: VSIX + dmg or AppImage + zip
.\install-clients.cmd
```

## Layout

```
plugins/embedded-client   Cordis patch plugin (loopback + ready file)
packages/client-runtime   download / spawn / ready / shutdown
apps/vscode               VS Code / Cursor VSIX
apps/desktop              Electron shell
engine.lock.json          upstream repository + fallback ref
```

## Hygiene

Do not commit `deepseek-harness/`, `.env`, release binaries, or competitive-analysis dumps. Run `pnpm hygiene` after changing community files.
