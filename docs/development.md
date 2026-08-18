# Development

Requires Node.js 22+ (`nvm use` reads `.nvmrc`) and pnpm 10 (`packageManager` in the root `package.json`).

```powershell
pnpm install
pnpm test
pnpm compile
pnpm verify          # hygiene + test + audit:layers + compile
```

The upstream Harness tree is **not** in git. Fetch it when you need to pack or smoke the real engine:

```powershell
pnpm fetch:engine                # uses DSH_ENGINE_REF or engine.lock.json
pnpm engine:resolve stable       # print the GitHub ref without cloning
.\build-clients.cmd              # fetch + build engine + pack this OS
./build-clients.sh               # same on macOS/Linux
.\install-clients.cmd            # install the packed VSIX
```

Default clone path is `deepseek-harness/` (gitignored). Override with `DSH_ENGINE_ROOT`. Treat that directory as read-only pack input.

Unpackaged `pnpm --dir apps/desktop start` and VS Code F5 use that clone when `apps/cli/lib/bin.js` exists. They do not use a stale PATH `dsh` unless you set `DSH_RUNTIME=local`.

## Checks

Run the narrowest command that covers your change:

- Client / runtime / plugin: `pnpm test`
- Layers: `pnpm audit:layers`
- Community files and unpublished-path policy: `pnpm hygiene`
- Before a PR: `pnpm verify`

Do not default to packing Electron installers on every change. `pnpm pack:desktop` and `.\build-clients.cmd` are for release or engine-integration work.

## Secrets

Copy `.env.example` to `.env` only on your machine. CI uses `GITHUB_TOKEN` for Releases API. Authenticode uses `CSC_LINK` / `CSC_KEY_PASSWORD` on the release workflow.
