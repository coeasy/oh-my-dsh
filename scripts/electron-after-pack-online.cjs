/** electron-builder afterPack for the slim system-runtime edition. */
const { copyFileSync, existsSync } = require('node:fs')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')

module.exports = async function afterPackOnline(context) {
  const root = join(__dirname, '..')
  const { appResourcesDir } = await import(
    pathToFileURL(join(__dirname, 'app-resources-dir.mjs')).href
  )
  const resources = appResourcesDir(context.appOutDir, context.electronPlatformName)
  const forbidden = [
    join(resources, 'runtime', 'harness'),
    join(resources, 'runtime', 'node'),
    join(resources, 'runtime', 'node.exe'),
    join(resources, 'runtime', 'dsh'),
    join(resources, 'runtime', 'dsh.cmd'),
  ]
  const leaked = forbidden.find((path) => existsSync(path))
  if (leaked) throw new Error(`online afterPack: bundled runtime leaked into slim package: ${leaked}`)

  const example = join(root, 'apps', 'desktop', 'env.example')
  if (existsSync(example)) copyFileSync(example, join(context.appOutDir, 'env.example'))
  for (const name of ['LICENSE', 'NOTICE']) {
    const source = join(root, name)
    if (existsSync(source)) copyFileSync(source, join(context.appOutDir, name))
  }
}
