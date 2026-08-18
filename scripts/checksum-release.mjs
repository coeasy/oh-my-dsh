/**
 * Write SHA256SUMS.txt for release artifacts under apps/desktop/dist-release.
 * Pass the desktop package version as argv[3] to ignore leftover builds.
 */
import { createHash } from 'node:crypto'
import { createReadStream, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadProductVersion } from './product-version.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = process.argv[2] || join(root, 'apps', 'desktop', 'dist-release')
const version = process.argv[3] || loadProductVersion(root)
const names = readdirSync(outDir).filter((name) => {
  if (!/\.(exe|zip|dmg|AppImage)$/u.test(name)) return false
  return name.includes(version)
})
if (names.length === 0) {
  throw new Error(`checksum-release: no version ${version} artifacts in ${outDir}`)
}

async function sha256(path) {
  const hash = createHash('sha256')
  const stream = createReadStream(path)
  for await (const chunk of stream) hash.update(chunk)
  return hash.digest('hex')
}

const lines = []
for (const name of names.sort()) {
  const digest = await sha256(join(outDir, name))
  lines.push(`${digest}  ${name}`)
}
const dest = join(outDir, 'SHA256SUMS.txt')
writeFileSync(dest, `${lines.join('\n')}\n`, 'utf8')
console.log(`OK: ${dest}`)
for (const line of lines) console.log(line)
