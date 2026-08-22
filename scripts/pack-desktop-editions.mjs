/** Build both release editions after desktop compile artifacts are ready. */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// Bundled keeps the default dist-release (with the engine runtime); the slim
// system edition is packed into dist-release-online so its electron-builder
// output never clobbers the bundled edition's win-unpacked.
for (const edition of ['bundled', 'system']) {
  const env = { ...process.env }
  if (edition === 'system') env.DSH_ELECTRON_OUTPUT = 'dist-release-online'
  const result = spawnSync(
    process.execPath,
    [join(root, 'scripts', 'pack-desktop.mjs'), `--edition=${edition}`],
    {
      cwd: root,
      env,
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
