# Publishing this repository to GitHub

This pack is ready to push as a **new public repository**. Do these maintainer steps once; they cannot be completed inside the source tree.

## 1. Create the empty GitHub repository

1. Create a public repo (suggested name: `dsh-client-pack` or `oh-my-dsh`).
2. Do **not** initialize it with a README, license, or `.gitignore` — this tree already has them.
3. Set the description to: unofficial VS Code / Cursor / Electron clients for DeepSeek Harness. Not affiliated with DeepSeek.
4. Add topics such as `deepseek`, `electron`, `vscode-extension`, `unofficial`.

Then set the clone URL in the root, `apps/vscode`, and `apps/desktop` `package.json` `repository` fields, and drop `--allow-missing-repository` from `scripts/pack-vscode.mjs` / the vscode pack script.

## 2. Replace CODEOWNERS

[`.github/CODEOWNERS`](../.github/CODEOWNERS) currently uses the placeholder `@dsh-client`. After the org or user exists, change it to a real `@user` or `@org/team`, or GitHub will warn on every PR.

## 3. Branch protection on `main`

Enable:

- Require a pull request before merging
- Require status checks: `verify` (the CI job in `.github/workflows/ci.yml`)
- Require conversation resolution
- Do not allow force pushes
- Optional: restrict who can push tags matching `v*`

## 4. Secrets for signed Windows builds

Release binaries stay unsigned (SmartScreen) until you add:

| Secret | Purpose |
|---|---|
| `CSC_LINK` | Base64 P12 / pfx for electron-builder |
| `CSC_KEY_PASSWORD` | Password for that certificate |

`GITHUB_TOKEN` is provided by Actions and is already passed to `pnpm build:clients:stable`.

### Verify a binary is signed

After a build, confirm a Windows artifact carries an Authenticode signature before shipping:

```powershell
node scripts/check-signature.mjs apps/desktop/dist-release/my-dsh-Setup-*.exe
```

It prints `SIGNED` or `UNSIGNED` and exits non-zero when any input is unsigned. Note this checks that a certificate table is present, not the trust chain — use `signtool verify /pa` or PowerShell `Get-AuthenticodeSignature` for full validation. Unsigned builds are expected until `CSC_LINK` is configured.

## 5. First push and first release

```powershell
git remote add origin git@github.com:<owner>/<repo>.git
git push -u origin HEAD:main
git tag v0.1.0
git push origin v0.1.0
```

The tag triggers [`.github/workflows/release.yml`](../.github/workflows/release.yml): verify, fetch GitHub **stable** Harness, pack VSIX plus native desktop artifacts on Windows, macOS, and Ubuntu, upload `SHA256SUMS.txt`.

### Fully-automated release loop

Beyond the manual tag above, the repo ships an optional **fully-automated** loop using [Changesets](https://github.com/changesets/changesets):

1. Contributors add a changeset for behavior changes: `pnpm changeset`.
2. On merge to `main`, [`.github/workflows/version.yml`](../.github/workflows/version.yml) opens/refreshes a **Version Packages** PR (bumps the fixed group + regenerates CHANGELOG).
3. Merging that PR runs `pnpm ci:publish` (`scripts/ci-publish.mjs`), which tags `v<version>` and pushes it — triggering the `release.yml` build above. No manual tag needed.

To enable it, ensure the `version` workflow has `contents: write` (already set) and that `main` has branch protection requiring the `verify` check. The first release can still use the manual tag path.

Releases are created as **drafts** with auto-generated notes; before publishing, fill in product details (upstream engine pin, install/verify steps, signature status) from the template in [docs/release-template.md](release-template.md).

### Auto-update

The desktop app currently ships **manual update checks only** (menu → Check for Updates opens the GitHub Release for the user to download and verify). The `publish` block in [`apps/desktop/electron-builder.yml`](../apps/desktop/electron-builder.yml) is kept so every release also emits the auto-update metadata (`latest.yml` on Windows / `latest-mac.yml` / `latest-linux.yml`) — this is the infrastructure a future [electron-updater](https://www.electron.build/auto-update) integration needs. `GH_OWNER` / `GH_REPO` are injected from the repository in the release job, so no extra secret is required.

Note: electron-updater is intentionally **not** bundled right now — the main process is emitted as ESM, and electron-updater's CJS dynamic `require` of native modules breaks in Electron's ESM main process (see the "Dynamic require of fs" crash). Re-enable auto-update after migrating the main process to CJS or once Electron's ESM support matures. Users can disable update checks via `autoUpdate: false` in `desktop-settings.json`.

## 6. What must never be pushed

`pnpm hygiene` rejects a tracked `deepseek-harness/` tree and tracked `docs/competitive-analysis/` dumps. Confirm with:

```powershell
git ls-files deepseek-harness docs/competitive-analysis
```

That command must print nothing. `.env` files are gitignored; only `.env.example` is tracked.

## 7. Marketplace (optional, later)

VS Code Marketplace / Open VSX publishing needs a publisher, PAT, and the `repository` field. Until then, distribute the VSIX from GitHub Releases.
