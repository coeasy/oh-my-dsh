# Platform entry points

This directory contains the human-facing wrappers for building and installing
clients on Windows, macOS, and Linux. They all change to the repository root
before invoking the canonical scripts in `scripts/`.

Use the package scripts for CI and development (`pnpm build:clients:*`,
`pnpm pack:vscode`, and `pnpm pack:desktop`). Use these wrappers when a
platform-native one-click entry point is more convenient.
