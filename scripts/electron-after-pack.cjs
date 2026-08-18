/**
 * electron-builder afterPack: copy the flattened payload harness (real files,
 * no SYMLINKD). Skip when dest is already a complete non-reparse tree;
 * otherwise rename dest aside and copy fresh.
 *
 * @param {import('app-builder-lib').AfterPackContext} context
 */
const { chmodSync, copyFileSync, existsSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')

module.exports = async function afterPack(context) {
  const root = join(__dirname, '..')
  const src = join(root, 'runtime', 'payload', 'harness')
  if (!existsSync(src)) {
    throw new Error(`afterPack: missing flattened payload ${src} — run pnpm stage:payload`)
  }
  const { appResourcesDir } = await import(pathToFileURL(join(__dirname, 'app-resources-dir.mjs')).href)
  const resources = appResourcesDir(context.appOutDir, context.electronPlatformName)
  mkdirSync(join(resources, 'runtime'), { recursive: true })
  const dest = join(resources, 'runtime', 'harness')
  const { copyHarnessFresh } = await import(pathToFileURL(join(__dirname, 'copy-harness.mjs')).href)
  const result = copyHarnessFresh(src, dest, { force: process.env.DSH_PACK_FORCE_HARNESS === '1' })
  if (result.skipped) {
    console.log(`afterPack: harness already complete at ${dest}`)
  } else if (result.stale) {
    console.log(`afterPack: renamed previous harness to ${result.stale}`)
  }
  const posixLauncher = join(resources, 'runtime', 'dsh')
  if (existsSync(posixLauncher)) {
    chmodSync(posixLauncher, 0o755)
  }
  const example = join(root, 'apps', 'desktop', 'env.example')
  if (existsSync(example)) {
    copyFileSync(example, join(context.appOutDir, 'env.example'))
  }
  for (const name of ['LICENSE', 'NOTICE']) {
    const srcFile = join(root, name)
    if (existsSync(srcFile)) copyFileSync(srcFile, join(context.appOutDir, name))
  }
}
