/** Build both release editions after desktop compile artifacts are ready. */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
for (const edition of ['bundled', 'system']) {
  const result = spawnSync(
    process.execPath,
    [join(root, 'scripts', 'pack-desktop.mjs'), `--edition=${edition}`],
    {
      cwd: root,
      env: process.env,
      encoding: 'utf8',
      windowsHide: true,
      stdio: 'inherit',
      timeout: 3_600_000,
    },
  )
  if (result.status !== 0) {
    throw new Error(`pack-desktop-editions: ${edition} failed (exit ${result.status})`)
  }
}
