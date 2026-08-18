import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'plugins', 'embedded-client', 'out', 'index.js')
if (!existsSync(src)) {
  throw new Error(`copy-plugin: missing ${src} — run pnpm compile:plugin first`)
}
const targets = process.argv.slice(2)
if (targets.length === 0) {
  throw new Error('usage: node scripts/copy-plugin.mjs <out-dir> ...')
}
for (const dir of targets) {
  mkdirSync(dir, { recursive: true })
  copyFileSync(src, join(dir, 'embedded-client.js'))
}
