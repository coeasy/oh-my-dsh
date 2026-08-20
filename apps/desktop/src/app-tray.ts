import { existsSync } from 'node:fs'
import { Menu, Tray, nativeImage } from 'electron'
import type { RuntimeSnapshot } from './contracts.ts'
import { trayMenuLabels, trayTooltip } from './status-tray.ts'

export interface StatusTray {
  update(snapshot: RuntimeSnapshot): void
  destroy(): void
}

/** Install the notification-area status tray, or `undefined` when the icon is missing. */
export function createStatusTray(input: {
  iconPath: string
  locale: 'en' | 'zh'
  snapshot: RuntimeSnapshot
  onShow: () => void
  onMarket: () => void
  onRestart: () => void
  onQuit: () => void
}): StatusTray | undefined {
  if (!existsSync(input.iconPath)) return undefined
  const image = nativeImage.createFromPath(input.iconPath)
  if (image.isEmpty()) return undefined
  const tray = new Tray(image)
  const labels = trayMenuLabels(input.locale)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: labels.show, click: () => input.onShow() },
      { label: labels.market, click: () => input.onMarket() },
      { label: labels.restart, click: () => input.onRestart() },
      { type: 'separator' },
      { label: labels.quit, click: () => input.onQuit() },
    ]),
  )
  tray.setToolTip(trayTooltip(input.snapshot, input.locale))
  tray.on('click', () => input.onShow())
  return {
    update(snapshot) {
      tray.setToolTip(trayTooltip(snapshot, input.locale))
    },
    destroy() {
      tray.destroy()
    },
  }
}
