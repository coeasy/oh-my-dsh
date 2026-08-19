/**
 * Copy the built plugin-marketplace (npm package @coeasy/dsh-plugin-marketplace)
 * into the desktop client's out dir so electron-builder ships it under
 * resources/plugin-marketplace. Only runtime artifacts are copied — no
 * node_modules, src, or build config.
 * The first-run bootstrap installs this bundled package via the official CLI:
 *   dsh plugin --profile web add file:<resources>/plugin-marketplace
 */

import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'plugins', 'plugin-marketplace')
const outDir = process.argv[2] || join(root, 'apps', 'desktop', 'out', 'plugin-marketplace')

const entries = ['package.json', 'cordis.patch.yml', 'lib', 'client', 'data']

if (!existsSync(join(src, 'lib', 'index.js')) || !existsSync(join(src, 'client', 'client.js'))) {
  console.error(
    'copy-market: missing built artifacts — run `pnpm --filter plugin-marketplace build` first',
  )
  process.exit(1)
}

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
for (const entry of entries) {
  cpSync(join(src, entry), join(outDir, entry), { recursive: true })
}
console.log(`copy-market: bundled plugin-marketplace -> ${outDir}`)
