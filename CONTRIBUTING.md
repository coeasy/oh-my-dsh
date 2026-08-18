# Contributing

This is an unofficial out-of-tree client pack. Do not edit `deepseek-harness/` even when a local clone exists; treat it as read-only pack input.

Please read [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) and [docs/development.md](docs/development.md).

## Setup

```powershell
pnpm install
pnpm test
pnpm compile
```

Fetch DeepSeek Harness when you need to pack, or use the one-click path in [docs/one-click-clients.md](docs/one-click-clients.md):

```powershell
.\build-clients.cmd stable
.\install-clients.cmd
```

## Checks

Run the narrowest command that covers your change:

- Client/runtime/plugin: `pnpm test`
- Layers: `pnpm audit:layers`
- Docs/CI hygiene: `pnpm hygiene`
- Before a PR: `pnpm verify`

## Releases

The product version is **0.1.0**. Keep every workspace `package.json` on that number until you intentionally cut a tagged release.

1. Change `version` in the root `package.json` first, then set `apps/desktop`, `apps/vscode`, `packages/client-runtime`, and `plugins/embedded-client` to the **same** value. `pnpm hygiene` rejects drift.
2. Update `CHANGELOG.md` (one heading for that version) and `engine.lock.json` if the fallback Harness ref moves.
3. Tag `vX.Y.Z` to match. The release workflow packs VSIX and native desktop artifacts plus `SHA256SUMS.txt`.
4. Optional Authenticode: set Actions secrets `CSC_LINK` (P12) and `CSC_KEY_PASSWORD`.

Do not bump to 0.2.0 (or any other number) because a feature landed. First-time GitHub setup is in [docs/publishing.md](docs/publishing.md).

## Naming

Keep README and about screens explicit that this client is unofficial. Do not imply DeepSeek publishes this repository.
