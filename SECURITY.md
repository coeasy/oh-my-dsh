# Security Policy

This is an unofficial client pack. Report vulnerabilities privately (GitHub Security Advisory on this repository once it exists, or a private maintainer contact). Do not open a public issue with exploit details.

## Scope

- `@dsh/client-runtime` spawn / download / loopback checks
- `@dsh/plugin-embedded-client` ready-file and host binding
- Electron shell (window trust, IPC, LAN phone bridge)
- VS Code / Cursor extension webview

Upstream DeepSeek Harness bugs belong in [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness).

## Defaults that matter

- The Harness HTTP server is bound to `127.0.0.1` only.
- Ready files must live under the system temp directory.
- Runtime downloads accept `https:` URLs only.
- The LAN phone bridge is **off until the user opens Connect Phone**. It then listens on `0.0.0.0` but accepts RFC1918/loopback clients and a pairing token. Treat it as same-Wi-Fi trust, not a public API.
- API keys in `.env` files are secrets. Never commit them. Diagnostic export redacts `DEEPSEEK_API_KEY` and similar keys.

## Signing

Release binaries should be Authenticode-signed when `CSC_LINK` / `CSC_KEY_PASSWORD` are available in CI. Unsigned builds will trigger Microsoft SmartScreen. That is expected until a certificate is configured.
