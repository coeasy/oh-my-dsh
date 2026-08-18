/**
 * Print the resolved engine ref for the requested channel.
 * Usage: node scripts/resolve-engine-ref.mjs [lock|stable|latest]
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEngineLock } from './engine-lock.mjs'
import { githubAuthToken, resolveEngineRef } from './github-engine.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const channel = (process.argv[2] || process.env.DSH_ENGINE_CHANNEL || 'lock').trim()
const resolved = await resolveEngineRef({
  channel,
  explicitRef: process.env.DSH_ENGINE_REF,
  lock: loadEngineLock(root),
})
process.stdout.write(`${JSON.stringify(resolved, null, 2)}\n`)
if (resolved.fallback && /GitHub 403/u.test(String(resolved.fallback)) && !githubAuthToken()) {
  process.stderr.write('hint: set GITHUB_TOKEN or GH_TOKEN so stable/latest can read GitHub Releases; without tags the resolver uses git ls-remote --heads then engine.lock.json\n')
}
