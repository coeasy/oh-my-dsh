/**
 * Cross-platform uninstall support (whole client + the market plugin itself).
 *
 * `uninstallMarket` removes the marketplace bundle from the official profile
 * via the same official CLI channel as install (pnpm remove + reconcile), so
 * it stays fully reversible and leaves no debris.
 *
 * `uninstallApp` launches the OS-native uninstaller for the my-dsh desktop
 * client:
 *   - Windows: queries the registry uninstall keys for the NSIS uninstall
 *     string (appId com.mydsh.desktop / "my-dsh") and runs it detached, so
 *     the running app quits and the system uninstaller takes over.
 *   - macOS / Linux: no single programmatic uninstall — return clear manual
 *     guidance instead of half-uninstalling.
 */

import { execFile, spawn } from 'node:child_process'
import { join } from 'node:path'

/** reg.exe via an absolute path — Node's PATH may not carry System32. */
const REG_EXE = process.env.SystemRoot ? join(process.env.SystemRoot, 'System32', 'reg.exe') : 'reg'

export interface UninstallResult {
  ok: boolean
  message: string
}

/** The market's own npm package name (removable via the official CLI). */
export const MARKET_PACKAGE = '@coeasy/dsh-plugin-marketplace'

/* ------------------------------------------------------------------ */
/* Windows registry uninstaller discovery                              */
/* ------------------------------------------------------------------ */

const UNINSTALL_ROOTS = [
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
]

/** reg query a root for a sub-key whose DisplayName/QuietDisplayName matches. */
function findUninstallKey(root: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      REG_EXE,
      ['query', root, '/s', '/f', 'my-dsh', '/d'],
      { windowsHide: true },
      (error, stdout) => {
        if (error || !stdout) return resolve(null)
        // Lines look like:  ...Uninstall\{guid}    DisplayName  REG_SZ  my-dsh
        // We need the containing key path (the last [...\Uninstall\<subkey>] header).
        const keys = new Set<string>()
        for (const line of stdout.split(/\r?\n/)) {
          const m = /\[([^\]]+)\]\s*$/.exec(line.trim())
          if (m && m[1].toLowerCase().includes('uninstall')) keys.add(m[1])
        }
        // Prefer a key that itself looks like the app's guid/uninstaller name.
        const match = [...keys].find((k) => /my-?dsh|mydsh/i.test(k))
        resolve(match ?? (keys.size > 0 ? [...keys][0] : null))
      },
    )
  })
}

/** Read the UninstallString of a given uninstall sub-key. */
function readUninstallString(key: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      REG_EXE,
      ['query', key, '/v', 'UninstallString'],
      { windowsHide: true },
      (error, stdout) => {
        if (error || !stdout) return resolve(null)
        const m = /UninstallString\s+REG_SZ\s+(.+)$/m.exec(stdout)
        resolve(m ? m[1].trim() : null)
      },
    )
  })
}

/** Resolve the NSIS uninstaller command on Windows, or null if not found. */
async function windowsUninstallString(): Promise<string | null> {
  for (const root of UNINSTALL_ROOTS) {
    const key = await findUninstallKey(root)
    if (key === null) continue
    const cmd = await readUninstallString(key)
    if (cmd !== null && cmd.trim() !== '') return cmd.trim()
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Launch the OS-native uninstaller for the my-dsh client. Detached: the
 * uninstaller terminates the running app, so we return a confirmation first
 * and let it take over the process lifecycle.
 */
export async function uninstallApp(): Promise<UninstallResult> {
  if (process.platform === 'win32') {
    const cmd = await windowsUninstallString()
    if (cmd === null) {
      return {
        ok: false,
        message:
          '未找到 my-dsh 卸载程序，请通过「设置 → 应用 → 已安装的应用」卸载 / uninstaller not found — use Windows Settings → Apps',
      }
    }
    // NSIS uninstaller asks for confirmation; run detached so we can reply first.
    spawn(cmd, { detached: true, stdio: 'ignore', windowsHide: false, shell: false }).unref()
    return { ok: true, message: '已启动 my-dsh 卸载程序 / my-dsh uninstaller launched' }
  }
  if (process.platform === 'darwin') {
    return {
      ok: false,
      message: '请将 my-dsh 应用拖入「废纸篓」完成卸载 / drag my-dsh into the Trash to uninstall',
    }
  }
  return {
    ok: false,
    message: '请通过系统包管理器卸载 my-dsh / uninstall my-dsh via your package manager',
  }
}
