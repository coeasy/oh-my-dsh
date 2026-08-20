import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('dshDesktop', {
  pickFolder: () => ipcRenderer.invoke('desktop:pick-folder'),
  setupDefaults: () => ipcRenderer.invoke('desktop:setup-defaults'),
  completeSetup: (payload: { workspace: string; apiKey: string }) =>
    ipcRenderer.invoke('desktop:complete-setup', payload),
  shouldSkipOnboarding: () => ipcRenderer.invoke('desktop:should-skip-onboarding'),
  marketAction: (request: { kind: string; payload: Record<string, unknown> }) =>
    ipcRenderer.invoke('market:action', request),
})

const MOBILE_BUTTON_ID = 'dsh-desktop-mobile-button'
const phoneIcon = `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" aria-hidden="true"><rect x="7" y="2.75" width="10" height="18.5" rx="2.25" stroke="currentColor" stroke-width="1.7"/><path d="M10.2 5.5h3.6M10.5 18.35h3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`
const locale = navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
let phoneConnected = false
const mobileButtonObserver = new MutationObserver(mountMobileButton)

function mountMobileButton(): void {
  let style = document.getElementById(`${MOBILE_BUTTON_ID}-style`)
  if (!style) {
    style = document.createElement('style')
    style.id = `${MOBILE_BUTTON_ID}-style`
    style.textContent = `
      [data-dsh-sidebar-footer] { position: relative; }
      [data-dsh-sidebar-root][data-dsh-sidebar-wide="true"] [data-dsh-sidebar-footer] > [class*="settingsArea"] { padding-right: 38px; }
      #${MOBILE_BUTTON_ID} { appearance:none; position:relative; width:32px; height:32px; color:var(--dsw-alias-label-secondary,#73777f); background:transparent; border:0; border-radius:9px; display:inline-flex; align-items:center; justify-content:center; cursor:pointer; }
      [data-dsh-sidebar-root][data-dsh-sidebar-wide="true"] #${MOBILE_BUTTON_ID} { position:absolute; right:0; top:50%; transform:translateY(-50%); }
      [data-dsh-sidebar-root][data-dsh-sidebar-wide="false"] #${MOBILE_BUTTON_ID} { margin-top:5px; }
      #${MOBILE_BUTTON_ID}:hover { color:var(--dsw-alias-label-primary,#202124); background:var(--dsw-alias-interactive-bg-hover,rgba(32,33,36,.08)); }
      #${MOBILE_BUTTON_ID}[hidden] { display:none; }
      #${MOBILE_BUTTON_ID} > span { position:absolute; top:4px; right:4px; width:7px; height:7px; border:1.5px solid var(--dsw-specific-sidebar-fill,#fff); border-radius:50%; background:#4da66d; opacity:0; }
      #${MOBILE_BUTTON_ID}.is-connected > span { opacity:1; }
    `
    document.head.appendChild(style)
  }
  const footer = document.querySelector<HTMLElement>('[data-dsh-sidebar-footer]')
  if (!footer) return
  let button = document.getElementById(MOBILE_BUTTON_ID) as HTMLButtonElement | null
  if (!button) {
    button = document.createElement('button')
    button.id = MOBILE_BUTTON_ID
    button.type = 'button'
    button.innerHTML = `${phoneIcon}<span aria-hidden="true"></span>`
    button.addEventListener('click', () => {
      void ipcRenderer.invoke('mobile:open-pairing').catch((error: unknown) => {
        console.error('[mobile] unable to open pairing window', error)
      })
    })
  }
  if (button.parentElement !== footer) footer.appendChild(button)
  const root = document.querySelector<HTMLElement>('[data-dsh-sidebar-root]')
  const wide = root?.dataset.dshSidebarWide === 'true'
  button.hidden = !wide && !phoneConnected
  button.classList.toggle('is-connected', phoneConnected)
  const label = phoneConnected
    ? locale === 'zh'
      ? '管理手机连接'
      : 'Manage phone connection'
    : locale === 'zh'
      ? '连接手机'
      : 'Connect phone'
  button.setAttribute('aria-label', label)
  button.title = label
}

/**
 * Auto-skip the engine's first-run onboarding takeover ("Add an API key to
 * get started") when the desktop side has already prompted the user for a key
 * but none was configured. This keeps the client opening to a usable UI
 * instead of a full-screen modal that blocks every button underneath.
 */
async function autoSkipOnboarding(): Promise<void> {
  try {
    const skip = (await ipcRenderer.invoke('desktop:should-skip-onboarding')) === true
    if (!skip) return
  } catch {
    return
  }
  const trySkip = (): void => {
    const dialog = document.querySelector<HTMLElement>('[class*="_root_"][aria-label]')
    const later = Array.from(document.querySelectorAll('button')).find((b) =>
      /稍后配置|Configure later/i.test(b.textContent ?? ''),
    )
    if (later) later.click()
    else if (dialog) {
      // fallback: any dialog that is an onboarding-style takeover with a
      // secondary dismiss action
      const secondary = dialog.querySelector<HTMLElement>('button[class*="secondary"]')
      secondary?.click()
    }
  }
  trySkip()
  const observer = new MutationObserver(() => trySkip())
  observer.observe(document.documentElement, { childList: true, subtree: true })
  window.setTimeout(() => observer.disconnect(), 20_000)
}

async function refreshMobileStatus(): Promise<void> {
  try {
    const status = (await ipcRenderer.invoke('mobile:status')) as { connected?: boolean }
    phoneConnected = status.connected === true
    mountMobileButton()
  } catch (error) {
    console.warn('[mobile] unable to read connection status', error)
  }
}

function initializeUi(): void {
  mountMobileButton()
  mobileButtonObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-dsh-sidebar-wide'],
  })
  void refreshMobileStatus()
  window.setInterval(() => void refreshMobileStatus(), 1000)
  void autoSkipOnboarding()
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initializeUi, { once: true })
} else {
  initializeUi()
}
