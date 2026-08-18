import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Stable userData folder. Never derived from the scoped npm name `@dsh/desktop`.
 *
 * @param platform Host OS
 * @param env Process environment (`APPDATA` / `XDG_CONFIG_HOME`)
 */
export function desktopUserDataPath(
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (platform === 'win32') {
    const roaming = env.APPDATA || join(homedir(), 'AppData', 'Roaming')
    return join(roaming, 'my-dsh')
  }
  if (platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'my-dsh')
  }
  const configHome = env.XDG_CONFIG_HOME || join(homedir(), '.config')
  return join(configHome, 'my-dsh')
}

export function launchRootPath(userDataPath: string): string {
  return join(userDataPath, 'launch-root')
}

export function harnessHomePath(userDataPath: string): string {
  return join(userDataPath, 'harness')
}

export async function ensureLaunchRoot(userDataPath: string): Promise<string> {
  const launchRoot = launchRootPath(userDataPath)
  await mkdir(launchRoot, { recursive: true })
  return launchRoot
}
