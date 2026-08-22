import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('dshDesktop', {
  pickFolder: () => ipcRenderer.invoke('desktop:pick-folder'),
  setupDefaults: () => ipcRenderer.invoke('desktop:setup-defaults'),
  completeSetup: (payload: { workspace: string; apiKey: string }) =>
    ipcRenderer.invoke('desktop:complete-setup', payload),
  shouldSkipOnboarding: () => ipcRenderer.invoke('desktop:should-skip-onboarding'),
  marketAction: (request: { kind: string; payload: Record<string, unknown> }) =>
    ipcRenderer.invoke('market:action', request),
  usageAnalytics: (request: { kind: string; payload?: unknown }) =>
    ipcRenderer.invoke('usage-analytics:action', request),
  modelConfig: (request: { kind: 'call'; method: string; args?: unknown[] }) =>
    ipcRenderer.invoke('model-config:action', request),
  degenerationGuard: (request: { kind: 'call'; method: string; args?: unknown[] }) =>
    ipcRenderer.invoke('degeneration-guard:action', request),
  /** Open an in-window plugin config panel (embedded WebContentsView). */
  pluginConfigOpen: (request: { plugin: string }) =>
    ipcRenderer.invoke('plugin-config:open', request),
  /** Close the in-window plugin panel (main-window embedded WebContentsView). */
  pluginConfigClose: () => ipcRenderer.invoke('plugin-config:close'),
  /** Open the mobile LAN pairing window. */
  mobileOpenPairing: () => ipcRenderer.invoke('mobile:open-pairing'),
  /** Read the mobile LAN bridge connection snapshot. */
  mobileStatus: () => ipcRenderer.invoke('mobile:status'),
  /** Check for an engine update (approval dialog on the desktop side). */
  engineCheckUpdate: () => ipcRenderer.invoke('engine:check-update'),
  /** Engine activity snapshot: active/pending versions + whether rollback exists. */
  engineActivity: () => ipcRenderer.invoke('engine:activity'),
  /** Activate a downloaded engine and restart the shell. */
  engineActivate: () => ipcRenderer.invoke('engine:activate'),
  /** Roll back to the previous usable engine and restart the shell. */
  engineRollback: () => ipcRenderer.invoke('engine:rollback'),
})

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

const USAGE_BAR_ID = 'dsh-usage-status-bar'
const USAGE_BAR_STYLE_ID = 'dsh-usage-status-bar-style'
const USAGE_BAR_POLL_MS = 3000
const USAGE_BAR_IDLE_MS = 10_000
let usageBarDelay = USAGE_BAR_POLL_MS
const CURRENCY_SYMBOL: Record<string, string> = { USD: '$', CNY: '¥', EUR: '€', JPY: '¥' }

function fmtTokens(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}
function fmtCost(n: number | null | undefined, currency: string | null | undefined): string {
  if (n === null || n === undefined) return '—'
  const symbol = CURRENCY_SYMBOL[currency ?? ''] ?? (currency ? `${currency} ` : '')
  return `${symbol}${n.toFixed(4)}`
}
function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return `${(n * 100).toFixed(1)}%`
}
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }
    return map[c]
  })
}
function usageStat(label: string, value: string): string {
  return `<span class="dsh-us-item"><span class="dsh-us-label">${esc(label)}</span><span class="dsh-us-value">${value}</span></span>`
}

/** Live session usage status bar (bottom of the harness page). Pulls
 * session-stats from the engine loopback API over IPC every few seconds and
 * re-renders in place. Unknown values render as '—', never 0. */
async function refreshUsageBar(): Promise<void> {
  const bar = document.getElementById(USAGE_BAR_ID)
  if (!bar) return
  try {
    const res = (await ipcRenderer.invoke('usage-analytics:action', {
      kind: 'query',
      payload: { view: 'session-stats' },
    })) as { ok?: boolean; data?: Record<string, unknown> | null } | null
    const s = res && res.ok === false ? null : (res?.data ?? null)
    if (!s || !s.session_id) {
      bar.innerHTML = '<span class="dsh-us-empty">Usage Analytics 未启用或暂无会话</span>'
      usageBarDelay = USAGE_BAR_IDLE_MS
      return
    }
    usageBarDelay = USAGE_BAR_POLL_MS
    const costEnabled = s.cost_enabled === true
    const lastIn = (s.last_input_tokens as number) ?? null
    const lastOut = (s.last_output_tokens as number) ?? null
    const lastTok = lastIn !== null || lastOut !== null ? (lastIn ?? 0) + (lastOut ?? 0) : null
    const sessIn = (s.input_tokens_exact as number) ?? null
    const sessOut = (s.output_tokens_exact as number) ?? null
    const sessTok = sessIn !== null || sessOut !== null ? (sessIn ?? 0) + (sessOut ?? 0) : null
    const items = [
      usageStat('模型', esc(String(s.model_id ?? '—'))),
      usageStat('本次tokens', fmtTokens(lastTok)),
      usageStat('本次命中', fmtTokens((s.last_cache_read_tokens as number) ?? null)),
      usageStat('会话tokens', fmtTokens(sessTok)),
      usageStat('平均命中', fmtPct((s.cache_hit_rate as number) ?? null)),
    ]
    const currency = (s.cost_currency as string) ?? null
    if (costEnabled) {
      items.push(usageStat('本次费用', fmtCost((s.last_cost_value as number) ?? null, currency)))
      items.push(usageStat('会话费用', fmtCost((s.cost_value as number) ?? null, currency)))
    } else {
      items.push('<span class="dsh-us-muted">费用未开启</span>')
    }
    items.push(
      usageStat('会话轮次', String(s.turn_count ?? 0)),
      usageStat('上下文', fmtTokens(sessTok)),
      usageStat('压缩阈值', '—'),
      usageStat('余额', '—'),
    )
    bar.innerHTML = items.join('')
  } catch {
    bar.innerHTML = '<span class="dsh-us-empty">Usage Analytics 不可用</span>'
  }
}

/** Self-rescheduling poll: back off to a slower cadence when there is no
 * active session (plugin not collecting), so the bar does not hammer IPC while
 * idle. */
function scheduleUsageBarPoll(): void {
  window.setTimeout(() => {
    void refreshUsageBar().then(() => scheduleUsageBarPoll())
  }, usageBarDelay)
}

function mountUsageStatusBar(): void {
  if (!document.body) return
  let style = document.getElementById(USAGE_BAR_STYLE_ID)
  if (!style) {
    style = document.createElement('style')
    style.id = USAGE_BAR_STYLE_ID
    style.textContent = `
      #${USAGE_BAR_ID} { position:fixed; left:0; right:0; bottom:0; z-index:2147483646; display:flex; align-items:center; gap:16px; padding:4px 14px; font:12px/1.6 system-ui,sans-serif; background:var(--dsw-alias-surface-primary,rgba(250,250,250,.96)); border-top:1px solid var(--dsw-alias-border,rgba(0,0,0,.1)); color:var(--dsw-alias-label-primary,#202124); box-sizing:border-box; white-space:nowrap; overflow-x:auto; }
      #${USAGE_BAR_ID} .dsh-us-item { display:inline-flex; align-items:baseline; gap:4px; }
      #${USAGE_BAR_ID} .dsh-us-label { color:var(--dsw-alias-label-secondary,#73777f); }
      #${USAGE_BAR_ID} .dsh-us-value { font-weight:500; }
      #${USAGE_BAR_ID} .dsh-us-empty, #${USAGE_BAR_ID} .dsh-us-muted { color:var(--dsw-alias-label-tertiary,#9aa0a6); }
    `
    document.head.appendChild(style)
  }
  let bar = document.getElementById(USAGE_BAR_ID) as HTMLElement | null
  if (!bar) {
    bar = document.createElement('div')
    bar.id = USAGE_BAR_ID
    document.body.appendChild(bar)
  }
  // The engine SPA manages its own internal scroll (a dedicated scrollBody
  // container); forcing 26px of body padding here made the body 26px taller
  // than the viewport, which resurrected a stray vertical scrollbar on the
  // maximized window. The bar is a fixed overlay — it no longer needs body
  // clearance, and the client's FILL_VIEWPORT_CSS pins body overflow hidden.
  void refreshUsageBar()
}

/** Engine SPA only: the in-window plugin panels load over file:// and must not
 * run the engine UI injections (usage bar / sidebar bridges / onboarding). */
function isEnginePage(): boolean {
  return location.protocol === 'http:' || location.protocol === 'https:'
}

function initializeUi(): void {
  if (!isEnginePage()) return
  mountUsageStatusBar()
  scheduleUsageBarPoll()
  void autoSkipOnboarding()
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initializeUi, { once: true })
} else {
  initializeUi()
}
