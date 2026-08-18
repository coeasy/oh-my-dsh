# `@dsh/plugin-embedded-client`

Out-of-tree Cordis plugin for client shells. It does not change DSH core.

- Lock `webserver` to `127.0.0.1` + port `0`.
- Write a JSON ready file once `webServer` is bound.

`dsh web --patch` overlays resolve plugin `name` as a **file: URL** (Windows ESM rejects `D:/...` paths), not an npm package. `@dsh/client-runtime` generates that overlay at spawn (`buildPatchYaml`). Do not point `--patch` at a YAML that names `@dsh/plugin-embedded-client`.

The shell must set `DSH_READY_FILE` (and optionally `DSH_WORKSPACE_CWD`) in the child environment.

This package must not import `vscode` or `electron`.
