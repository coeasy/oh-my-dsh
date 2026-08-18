/**
 * Canonical local clone of https://github.com/deepseek-ai/deepseek-harness.
 * Default path is `<repo>/deepseek-harness` and is gitignored. Override with
 * DSH_ENGINE_ROOT. Scripts never patch files inside this tree.
 */
import { join } from 'node:path'

export const ENGINE_CLONE_DIRNAME = 'deepseek-harness'

/**
 * @param {string} root repository root
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string} absolute clone directory
 */
export function defaultEngineRoot(root, env = process.env) {
  const override = String(env.DSH_ENGINE_ROOT || '').trim()
  if (override) return override
  return join(root, ENGINE_CLONE_DIRNAME)
}
