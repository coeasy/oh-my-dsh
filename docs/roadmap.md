# Roadmap

> Last reviewed: 2026-08-20
>
> This document tracks current work only. Historical proposals, implementation
> notes, and release drafts live under [`docs/archive/`](archive/README.md).

## Current baseline

- VS Code / Cursor extension and Electron desktop clients share the client runtime.
- Bundled and system-runtime desktop editions are supported.
- The marketplace uses server-resolved catalog specs, a host IPC broker, and
  atomic Skill/Preset installation.
- CI covers typecheck, lint, formatting, tests, layer checks, compilation,
  packaging smoke checks, and weekly latest-engine compatibility evidence.
- The current test baseline is 233 passing tests.

## Remaining priorities

### P0 — Release confidence

- Add real desktop end-to-end coverage for first launch, loopback navigation,
  shutdown, and recovery. The current desktop checks are unit/source-level and
  packaging smoke checks.
- Run full installer smoke tests on clean Windows, macOS, and Linux runners,
  including both bundled and system-runtime desktop editions.
- Keep the compatibility matrix and weekly workflow evidence aligned with the
  exact engine ref that was tested.

### P1 — Distribution trust

- Configure Windows Authenticode signing and macOS Developer ID signing and
  notarization once the required certificates and accounts are available.
- Publish signature status and SHA256 verification results in every release.

### P2 — Product expansion

- Complete the engine update flow from detection through user approval,
  activation, restart, and rollback in released clients.
- Evaluate JetBrains support with a loopback/JCEF proof of concept before
  committing to a production integration.
- Consider multi-session workspaces and richer first-run recovery after the
  desktop E2E baseline is in place.

## Completed in the latest hardening cycle

- Marketplace mutations moved behind a trusted host broker and native
  confirmation boundary.
- Catalog/spec resolution, pagination/cache behavior, npm integrity checks,
  atomic installation, and bounded logs were added.
- VSIX defaults to local runtime mode; desktop loopback origins are exact;
  Windows launcher argument handling is direct and bounded.
- Desktop packaging was split into bundled and system-runtime editions, with
  compatibility evidence running weekly.

## Source of truth

Behavior is defined by source code, tests, CI configuration, and release
artifacts. This roadmap is only a planning index; completed work should be
removed from the priority sections rather than copied into another historical
plan.
