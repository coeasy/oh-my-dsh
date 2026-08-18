import { join } from 'node:path'

/** electron-builder `appOutDir` resources folder (`Resources` on macOS). */
export function appResourcesDir(appOutDir, electronPlatformName = process.platform) {
  const root = String(appOutDir || '')
  if (electronPlatformName === 'darwin') return join(root, 'Resources')
  return join(root, 'resources')
}
