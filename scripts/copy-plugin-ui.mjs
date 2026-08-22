/**
 * Copy the built standalone UI bundles for the bundled first-party plugins
 * (model-config / degeneration-guard / usage-analytics) into the desktop
 * resource tree so the plugin config windows can load them in dev and in the
 * packaged app. Only the built IIFE artifacts are copied (esbuild
 * ui-src/mount.ts → ui/bundle.js); sources stay in the plugin packages.
 *
 *   node scripts/copy-plugin-ui.mjs [outDir]
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const outDir = process.argv[2] || join(root, 'apps', 'desktop', 'plugin-ui')

/** plugin package dir -> dest file name (used as the HTML <script> basename). */
const UI_BUNDLES = [
  { pkg: 'model-config', dest: 'model-config.js' },
  { pkg: 'degeneration-guard', dest: 'degeneration-guard.js' },
  { pkg: 'usage-analytics', dest: 'usage-analytics.js' },
]

mkdirSync(outDir, { recursive: true })
let copied = 0
for (const { pkg, dest } of UI_BUNDLES) {
  const src = join(root, 'plugins', pkg, 'ui', 'bundle.js')
  if (!existsSync(src)) {
    throw new Error(`copy-plugin-ui: missing ${src} — run the plugin build first (pnpm --filter @dsh/plugin-${pkg} build)`)
  }
  copyFileSync(src, join(outDir, dest))
  copied += 1
}
console.log(`copy-plugin-ui: ${copied} plugin UI bundles -> ${outDir}`)
