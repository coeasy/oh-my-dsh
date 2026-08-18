/**
 * Product version is the root package.json `version`. Every workspace
 * package.json must match it. Do not bump one app to 0.2.0 while others stay
 * on 0.1.0, and do not invent a new number without a tagged release.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const PRODUCT_PACKAGES = [
  'package.json',
  'apps/desktop/package.json',
  'apps/vscode/package.json',
  'packages/client-runtime/package.json',
  'plugins/embedded-client/package.json',
]

export function readJsonVersion(path) {
  const json = JSON.parse(readFileSync(path, 'utf8'))
  if (typeof json.version !== 'string' || !json.version.trim()) {
    throw new Error(`missing version in ${path}`)
  }
  return json.version.trim()
}

export function loadProductVersion(root) {
  return readJsonVersion(join(root, 'package.json'))
}

export function collectPackageVersions(root) {
  return PRODUCT_PACKAGES.map((relative) => ({
    relative,
    version: readJsonVersion(join(root, relative)),
  }))
}

export function assertAlignedVersions(root, expected) {
  const want = expected || loadProductVersion(root)
  const drifted = collectPackageVersions(root).filter((row) => row.version !== want)
  if (drifted.length > 0) {
    throw new Error(
      `workspace versions must all be ${want}; drifted: ${drifted
        .map((row) => `${row.relative}=${row.version}`)
        .join(', ')}`,
    )
  }
  return want
}
