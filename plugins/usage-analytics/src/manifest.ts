/**
 * Plugin manifest validation (install/load-time).
 *
 * Mirrors the plan's manifest contract: id, version, api_version, targets,
 * permissions, entries, schema_version. Validates structure + permission
 * whitelist. Returns a list of problems (empty = valid).
 */

export const PLUGIN_ID = 'com.my-dsh.usage-analytics'

export type Target = 'desktop' | 'web' | 'vscode'

export interface PluginManifest {
  id: string
  name: string
  version: string
  api_version: string
  targets: Target[]
  permissions: string[]
  host_entry: string
  ui_entry?: string
  schema_version: number
  signature?: string
}

/** Permissions the plan allows by default. Anything else is rejected. */
export const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set([
  'usage.observe',
  'storage.local',
  'ui.mount',
  'events.subscribe',
])

/** Permissions the plan explicitly forbids in phase one. */
export const FORBIDDEN_PERMISSIONS: ReadonlySet<string> = new Set([
  'network.any',
  'filesystem.any',
  'native_code',
  'process.spawn',
  'credential.read',
])

export const SUPPORTED_API_VERSION = 'plugin.host.v1'
export const CURRENT_SCHEMA_VERSION = 1

export function validateManifest(cfg: unknown): string[] {
  const problems: string[] = []
  if (typeof cfg !== 'object' || cfg === null) return ['manifest must be an object']
  const m = cfg as Record<string, unknown>

  if (typeof m.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(m.id)) {
    problems.push('id must be a dotted identifier')
  }
  if (typeof m.name !== 'string' || m.name.length === 0) problems.push('name required')
  if (typeof m.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(m.version)) {
    problems.push('version must be semver (x.y.z)')
  }
  if (m.api_version !== SUPPORTED_API_VERSION) {
    problems.push(`api_version must be ${SUPPORTED_API_VERSION}`)
  }
  if (m.schema_version !== CURRENT_SCHEMA_VERSION) {
    problems.push(`schema_version must be ${CURRENT_SCHEMA_VERSION}`)
  }
  if (!Array.isArray(m.targets) || m.targets.length === 0) {
    problems.push('targets must be a non-empty array')
  } else {
    for (const t of m.targets) {
      if (!['desktop', 'web', 'vscode'].includes(String(t)))
        problems.push(`unsupported target: ${String(t)}`)
    }
  }
  if (typeof m.host_entry !== 'string' || m.host_entry.length === 0) {
    problems.push('host_entry required')
  }
  if (m.ui_entry !== undefined && (typeof m.ui_entry !== 'string' || m.ui_entry.length === 0)) {
    problems.push('ui_entry must be a string when present')
  }

  if (!Array.isArray(m.permissions)) {
    problems.push('permissions must be an array')
  } else {
    for (const p of m.permissions) {
      if (FORBIDDEN_PERMISSIONS.has(String(p)))
        problems.push(`forbidden permission requested: ${p}`)
      if (!ALLOWED_PERMISSIONS.has(String(p))) problems.push(`unknown permission: ${p}`)
    }
  }
  return problems
}

/** The shipped manifest for this plugin. */
export function defaultManifest(): PluginManifest {
  return {
    id: PLUGIN_ID,
    name: 'Usage Analytics',
    version: '0.1.0',
    api_version: SUPPORTED_API_VERSION,
    targets: ['desktop', 'vscode'],
    permissions: ['usage.observe', 'storage.local', 'ui.mount', 'events.subscribe'],
    host_entry: 'src/index.ts',
    ui_entry: 'ui/bundle.js',
    schema_version: CURRENT_SCHEMA_VERSION,
  }
}
