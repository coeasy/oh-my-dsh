import { shell, type BrowserWindow, type WebContents, type WebContentsView } from 'electron'
import { canGrantWindowPermission, isTrustedAppUrl } from './security-policy.ts'

export type TrustedOriginSource = string[] | (() => string[])

function origins(source: TrustedOriginSource): string[] {
  return typeof source === 'function' ? source() : source
}

/** Anything exposing a webContents (BrowserWindow, WebContentsView, …). */
export type SecurableContents = { webContents: WebContents } | BrowserWindow | WebContentsView

export function secureWindow(
  target: SecurableContents,
  trustedFileRoots: string[] = [],
  trustedOrigins: TrustedOriginSource = [],
): void {
  const window = target
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedAppUrl(url, trustedFileRoots, origins(trustedOrigins))) return { action: 'allow' }
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    if (isTrustedAppUrl(url, trustedFileRoots, origins(trustedOrigins))) return
    event.preventDefault()
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url)
  })

  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  window.webContents.session.setPermissionCheckHandler(
    (_webContents, permission, requestingOrigin, details) =>
      canGrantWindowPermission(
        permission,
        details.requestingUrl ?? requestingOrigin,
        details.isMainFrame,
        origins(trustedOrigins),
      ),
  )
  window.webContents.session.setPermissionRequestHandler(
    (_webContents, permission, callback, details) => {
      callback(
        canGrantWindowPermission(
          permission,
          details.requestingUrl,
          details.isMainFrame,
          origins(trustedOrigins),
        ),
      )
    },
  )
}
