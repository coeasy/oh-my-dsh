export const HARNESS_WINDOW_TITLE = 'my-dsh'
export const TITLE_BAR_OVERLAY_HEIGHT = 36
export const FILL_VIEWPORT_CSS =
  'html, body { margin: 0 !important; height: 100% !important; width: 100% !important; }'

/**
 * The native titleBarOverlay reserves the top `height` pixels as a window
 * drag region. The engine SPA renders its own top bar (logo / sidebar toggle)
 * inside that region, so clicks on those buttons would be swallowed by the
 * drag region. Mark every interactive element as no-drag so buttons remain
 * clickable; the remaining non-interactive strip stays draggable.
 */
export const NO_DRAG_INTERACTIVES_CSS = `
button, a, input, select, textarea, label, [role="button"], [role="tab"],
[role="menuitem"], [role="checkbox"], [role="radio"], [role="switch"],
summary, [contenteditable="true"] {
  -webkit-app-region: no-drag !important;
}
`

export interface TitleBarOverlay {
  color: string
  symbolColor: string
  height: number
}

/** Native caption buttons without a title-text bar so the SPA can fill the window. */
export function titleBarOverlay(dark: boolean): TitleBarOverlay {
  return {
    color: dark ? '#141416' : '#f8f8f6',
    symbolColor: dark ? '#f3f4f6' : '#17181a',
    height: TITLE_BAR_OVERLAY_HEIGHT,
  }
}

/** BrowserWindow chrome: hidden menu, hidden title text, overlay controls. */
export function desktopChromeOptions(dark: boolean): {
  title: string
  autoHideMenuBar: true
  titleBarStyle: 'hidden'
  titleBarOverlay: TitleBarOverlay
  backgroundColor: string
} {
  return {
    title: HARNESS_WINDOW_TITLE,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: titleBarOverlay(dark),
    backgroundColor: dark ? '#141416' : '#f8f8f6',
  }
}
