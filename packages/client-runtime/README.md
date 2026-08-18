# `@dsh/client-runtime`

Shell-side library (not a Cordis plugin). Resolves a `dsh` binary, spawns `dsh web` with the embedded-client patch, waits for the ready file, and shuts the child down.

```ts
import { launchHost } from '@dsh/client-runtime'

const host = await launchHost({ workspaceCwd: process.cwd() })
// host.url → http://127.0.0.1:<port>
await host.stop()
```

- `DSH_RUNTIME=local` (explicit): `DSH_BIN` or `dsh` on PATH
- Unpackaged shells without `DSH_RUNTIME`: `runtime/stage` then a clone-backed `runtime/dev` launcher
- `DSH_RUNTIME=bundled`: absolute launcher inside the desktop installer (`dshCommand` / `DSH_BIN`); missing file fails loud
- `DSH_RUNTIME=download`: use `%USERPROFILE%\.dsh-client\runtime`; missing cache + missing `DSH_RUNTIME_URL` fails loud
