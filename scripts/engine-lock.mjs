import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * @param {string} root
 * @returns {{ repository: string, ref: string, webMustBeBuilt: boolean }}
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
    webMustBeBuilt: raw.webMustBeBuilt !== false,
  }
}
