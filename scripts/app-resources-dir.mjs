import { join } from 'node:path'

/** electron-builder `appOutDir` resources folder (`Resources` on macOS). */
export function appResourcesDir(appOutDir, electronPlatformName = process.platform) {
  const root = String(appOutDir || '')
  // electron-builder has used both `darwin` and `mac` for this context field
  // across versions. Keep the filesystem lookup correct for either spelling.
  if (electronPlatformName === 'darwin' || electronPlatformName === 'mac') {
    return join(root, 'Resources')
  }
  return join(root, 'resources')
}
