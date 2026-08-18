import { statSync } from 'node:fs'

export function isUsableWorkspace(path: string): boolean {
  if (!path) return false
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

export function resolveLaunchDirectory(
  savedWorkspace: string | undefined,
  fallbackLaunchRoot: string,
): string {
  if (savedWorkspace && isUsableWorkspace(savedWorkspace)) return savedWorkspace
  return fallbackLaunchRoot
}
