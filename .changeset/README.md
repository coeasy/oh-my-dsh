# Changesets

This repository uses [Changesets](https://github.com/changesets/changesets) to
keep all workspace package versions aligned to the product version (see
`scripts/product-version.mjs`).

## How it works

- The `fixed` group in `.changeset/config.json` locks
  `@dsh/client-runtime`, `@dsh/plugin-embedded-client`, `my-dsh-vscode`, and
  `@dsh/desktop` so they always bump together.
- Every change that affects a released package should include a changeset:

  ```bash
  pnpm changeset
  ```

  This writes a `.changeset/*.md` file describing the change.

- On merge to `main`, a "Version Packages" PR bumps all packages in the fixed
  group together and regenerates the per-package `CHANGELOG.md`. The root
  `CHANGELOG.md` is the product-facing changelog and is updated manually on a
  release.

## Adding a changeset

1. Run `pnpm changeset`.
2. Select the affected packages.
3. Choose a bump level — for this project, use `patch` unless a tagged minor
   release is planned. The fixed group keeps everything in lockstep regardless.
4. Describe the change in plain English.
