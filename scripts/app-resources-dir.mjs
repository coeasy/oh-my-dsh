import { readdirSync } from 'node:fs'
import { basename, join } from 'node:path'

/**
 * electron-builder `appOutDir` resources folder (`Resources` on macOS).
 *
 * @param {string} appOutDir
 * @param {string} [electronPlatformName]
 * @returns {string}
 */
export function appResourcesDir(appOutDir, electronPlatformName = process.platform) {
  const root = String(appOutDir || '')
  // electron-builder has used both `darwin` and `mac` for this context field
  // across versions. Its macOS appOutDir is the parent containing `*.app`,
  // while post-pack validation uses `*.app/Contents`; support both shapes.
  if (electronPlatformName === 'darwin' || electronPlatformName === 'mac') {
    if (basename(root) === 'Contents') return join(root, 'Resources')
    if (basename(root).endsWith('.app')) return join(root, 'Contents', 'Resources')
    try {
      const app = readdirSync(root, { withFileTypes: true }).find(
        (entry) => entry.isDirectory() && entry.name.endsWith('.app'),
      )
      if (app) return join(root, app.name, 'Contents', 'Resources')
    } catch {
      // Fall through to the legacy direct Resources layout when the app dir
      // does not exist yet (for example during unit tests or early hooks).
    }
    return join(root, 'Resources')
  }
  return join(root, 'resources')
}
