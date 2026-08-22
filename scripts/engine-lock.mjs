import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * @param {string} root
 * @returns {{ repository: string, ref: string, pinnedCommit: string | null, webMustBeBuilt: boolean }}
 */
export function loadEngineLock(root) {
  const raw = JSON.parse(readFileSync(join(root, 'engine.lock.json'), 'utf8'))
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('engine.lock.json must be an object')
  }
  const repository = typeof raw.repository === 'string' ? raw.repository.trim() : ''
  const ref = typeof raw.ref === 'string' ? raw.ref.trim() : ''
  if (!repository || !ref) {
    throw new Error('engine.lock.json requires repository and ref')
  }
  return {
    repository,
    ref,
    pinnedCommit: typeof raw.pinnedCommit === 'string' && raw.pinnedCommit ? raw.pinnedCommit : null,
    webMustBeBuilt: raw.webMustBeBuilt !== false,
  }
}

/**
 * @param {string} root
 * @param {{ repository: string, ref: string, pinnedCommit?: string | null, webMustBeBuilt?: boolean }} next
 */
export function writeEngineLock(root, next) {
  const current = loadEngineLock(root)
  const merged = {
    repository: next.repository ?? current.repository,
    ref: next.ref ?? current.ref,
    ...(next.pinnedCommit !== undefined ? { pinnedCommit: next.pinnedCommit } : {}),
    ...(next.webMustBeBuilt !== undefined
      ? { webMustBeBuilt: next.webMustBeBuilt }
      : { webMustBeBuilt: current.webMustBeBuilt }),
  }
  const body = `${JSON.stringify(merged, null, 2)}\n`
  writeFileSync(join(root, 'engine.lock.json'), body, 'utf8')
  return merged
}
