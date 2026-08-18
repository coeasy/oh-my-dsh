# PRD: unofficial DeepSeek Harness client pack (GitHub-ready)

> version: 2  ambiguity: low
> artifacts: `prd/PRD.md`

## Executive Summary

oh-my-dsh is an unofficial VS Code / Cursor VSIX and Electron desktop pack around DeepSeek Harness. It must not vendor Harness sources. Local and CI builds fetch https://github.com/deepseek-ai/deepseek-harness (stable, else latest release), clone into gitignored `deepseek-harness/`, then pack and optionally install clients. The published tree is industrial-grade and safe to push to a new GitHub repository.

## Goal

Ship a GitHub-ready client pack that:

1. Does not store `deepseek-harness/` sources in git.
2. Resolves the upstream engine from GitHub by default (`stable` → latest non-prerelease, else latest release); `engine.lock.json` remains the pin/fallback.
3. Lets a developer one-click fetch, build, pack, and install the latest clients on Windows.
4. Includes community, security, CI, and publishing files required for a public repository.
5. Keeps unpublished dumps (competitive analysis, agent session markdown, aza residue) out of git.

Constraints: do not fork or patch the kernel; keep MIT and the unofficial disclaimer.

## User Stories

- As a Windows user, I can double-click `build-clients.cmd` then `install-clients.cmd` and get the latest stable Harness inside Cursor/VS Code without cloning the kernel by hand.
- As a maintainer, I can push this tree to a new GitHub repo without leaking Harness sources, API keys, or internal research dumps.
- As a contributor, I can run `pnpm verify` and know hygiene, tests, layer audit, and compile all passed.
- As a release operator, tagging `vX.Y.Z` packs VSIX + NSIS + portable + zip from GitHub stable Harness and uploads checksums.
- As a security reviewer, I can find LICENSE, NOTICE, SECURITY, CODE_OF_CONDUCT, and a private reporting path.

## Success Metrics

- `git ls-files deepseek-harness docs/competitive-analysis` is empty.
- `.gitignore` contains `/deepseek-harness/`.
- Default clone path from `scripts/engine-root.mjs` is `<repo>/deepseek-harness`.
- `pnpm hygiene` and `pnpm test` pass.
- Community files listed in `scripts/check-hygiene.mjs` exist.
- One-click path documented: `build-clients.cmd` + `install-clients.cmd`.
- `docs/publishing.md` lists remaining GitHub-org steps (remote, CODEOWNERS user, branch protection, Authenticode secrets).

## Scope

- Engine clone path + gitignore + hygiene gate
- One-click build/install scripts
- GitHub community and CI files
- Public docs (README, development, architecture, publishing)
- Tests for pin, GitHub resolution, and clone path

## Non-goals

- Forking or patching DeepSeek Harness
- Publishing to VS Code Marketplace / Open VSX in this change
- Authenticode certificate purchase
- Creating the GitHub org/remote (maintainer action; documented)
- Re-running a full Electron pack in this change (needs a built clone and long Windows CI)

## Acceptance Criteria

- [x] Engine clone defaults to gitignored `./deepseek-harness` (check=code, blocking=true, evidence_path=scripts/engine-root.mjs)
- [x] Scripts do not hardcode `docs/competitive-analysis` as the clone (check=hygiene, blocking=true, evidence_path=scripts/check-hygiene.mjs)
- [x] GitHub latest stable is the default build channel (check=code, blocking=true, evidence_path=scripts/build-clients.mjs)
- [x] Local install entry exists (check=artifact, blocking=true, evidence_path=scripts/install-clients.mjs)
- [x] Community files complete (check=hygiene, blocking=true, evidence_path=scripts/check-hygiene.mjs)
- [x] Publishing checklist exists (check=artifact, blocking=true, evidence_path=docs/publishing.md)
- [x] Unpublished dumps are gitignored (check=gitignore, blocking=true, evidence_path=.gitignore)
- [x] Tests cover engine pin + clone path (check=test, blocking=true, evidence_path=apps/desktop/tests/engine-pin.test.ts)
- [x] Unofficial MIT NOTICE retained (check=artifact, blocking=true, evidence_path=NOTICE)
- [x] `prd/PRD.md` contains User Stories / Success Metrics / Acceptance Criteria (check=prd, blocking=true, evidence_path=prd/PRD.md)

## Reference Sources

- https://github.com/deepseek-ai/deepseek-harness
- docs/one-click-clients.md
- docs/publishing.md

## Risks

- Nested `deepseek-harness/.git` can confuse parent `git status` until gitignored.
- GitHub API 403 without a token; resolver falls back to `git ls-remote` then `engine.lock.json`.
- Unsigned NSIS triggers SmartScreen until `CSC_LINK` is set.

## Constraints

- default_mode=auto
- require_evidence=true
- no_placeholders=true
- require_tests=true
