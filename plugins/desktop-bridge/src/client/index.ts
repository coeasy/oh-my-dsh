/**
 * @dsh/plugin-desktop-bridge client: registers the desktop shell's first-party
 * config entry buttons into the OFFICIAL `sidebar.footer.action` slot, instead
 * of the old preload/DOM-injection path (which depends on CSS-module hashed
 * class names). Each entry routes through the preload's existing
 * `window.dshDesktop.pluginConfigOpen` bridge to open the config panel
 * (WebContentsView) for model-config / degeneration-guard / usage-analytics.
 *
 * Rendering uses native elements + dsw theme tokens (no ui-primitives dep), so
 * the entries render on any host with the theme sheet and never blank the
 * sidebar on older hosts. The plugin only registers the entries when the
 * desktop bridge is actually present — under a plain web/VS Code host there is
 * no desktop panel to open, so dead buttons are never mounted.
 */

import { createElement as h, useEffect, useState } from 'react'

/** one open <path> feature per entry, drawn inside a shared 24px viewBox. */
const ICONS: Record<string, ReturnType<typeof h>[]> = {
  'model-config': [
    h('path', {
      d: 'M4 7h10M18 7h2M4 17h2M10 17h10',
      stroke: 'currentColor',
      strokeWidth: 1.8,
      strokeLinecap: 'round',
    }),
    h('circle', { cx: 15, cy: 7, r: 2.4, stroke: 'currentColor', strokeWidth: 1.8 }),
    h('circle', { cx: 7, cy: 17, r: 2.4, stroke: 'currentColor', strokeWidth: 1.8 }),
  ],
  'degeneration-guard': [
    h('path', {
      d: 'M12 3l7 3v5c0 4.4-3 8-7 10-4-2-7-5.6-7-10V6l7-3z',
      stroke: 'currentColor',
      strokeWidth: 1.8,
      strokeLinejoin: 'round',
    }),
    h('path', {
      d: 'M9 12l2 2 4-4',
      stroke: 'currentColor',
      strokeWidth: 1.8,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),
  ],
  'usage-analytics': [
    h('path', {
      d: 'M5 20V10M12 20V4M19 20v-7',
      stroke: 'currentColor',
      strokeWidth: 1.8,
      strokeLinecap: 'round',
    }),
  ],
  'mobile-pairing': [
    h('rect', {
      x: 7,
      y: 2.75,
      width: 10,
      height: 18.5,
      rx: 2.25,
      stroke: 'currentColor',
      strokeWidth: 1.8,
    }),
    h('path', {
      d: 'M10.2 5.5h3.6M10.5 18.35h3',
      stroke: 'currentColor',
      strokeWidth: 1.8,
      strokeLinecap: 'round',
    }),
  ],
}

interface ActionDef {
  id: string
  zh: string
  en: string
  /** Calls a custom bridge method instead of pluginConfigOpen. */
  open?: 'pair'
}
const ACTIONS: readonly ActionDef[] = [
  { id: 'model-config', zh: '模型配置', en: 'Model' },
  { id: 'degeneration-guard', zh: '退化防护', en: 'Guard' },
  { id: 'usage-analytics', zh: '用量分析', en: 'Usage' },
  { id: 'mobile-pairing', zh: '连接手机', en: 'Phone', open: 'pair' },
]

interface SlotsService {
  inject(slot: string, register: () => unknown): void
  register(
    meta: Record<string, unknown>,
    component: (props: Record<string, unknown>) => unknown,
  ): unknown
}
interface LocaleService {
  language?: string
}
interface BridgeClientContext {
  slots: SlotsService
  locale: LocaleService
}

function languageOf(ctx: BridgeClientContext): 'zh' | 'en' {
  const lang = ctx.locale.language ?? (typeof navigator !== 'undefined' ? navigator.language : 'en')
  return typeof lang === 'string' && lang.startsWith('zh') ? 'zh' : 'en'
}

const STYLE = {
  entryBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    width: '100%',
    padding: '8px 12px',
    borderRadius: '8px',
    border: 'none',
    cursor: 'pointer',
    fontSize: '13px',
    color: 'var(--dsw-alias-label-primary,#e8eaed)',
    background: 'transparent',
    textAlign: 'left' as const,
  },
  entryBtnRail: { justifyContent: 'center', padding: '8px 0' },
  icon: { display: 'inline-flex', flexShrink: 0, position: 'relative' as const },
  label: { flex: '1', whiteSpace: 'nowrap' as const, overflow: 'hidden' },
  dot: {
    position: 'absolute' as const,
    top: 3,
    right: 3,
    width: 7,
    height: 7,
    borderRadius: '50%',
    background: '#4da66d',
    border: '1.5px solid var(--dsw-specific-sidebar-fill,#fff)',
  },
}

function FooterAction(props: {
  id: string
  zh: string
  en: string
  open?: 'pair'
  wide?: boolean
  locale: 'zh' | 'en'
}): ReturnType<typeof h> {
  const { id, zh, en, open, wide, locale } = props
  const [connected, setConnected] = useState(false)
  useEffect(() => {
    if (open !== 'pair') return
    const sync = async (): Promise<void> => {
      try {
        const st = await window.dshDesktop?.mobileStatus?.()
        setConnected(st?.connected === true)
      } catch {
        setConnected(false)
      }
    }
    void sync()
    const timer = window.setInterval(() => void sync(), 1000)
    return () => window.clearInterval(timer)
  }, [open])
  const label =
    open === 'pair' && connected
      ? locale === 'zh'
        ? '管理手机连接'
        : 'Manage phone connection'
      : locale === 'zh'
        ? zh
        : en
  const openAction = (): void => {
    const bridge = window.dshDesktop
    if (!bridge) return
    if (open === 'pair') {
      if (!bridge.mobileOpenPairing) return
      void bridge.mobileOpenPairing().catch((error: unknown) => {
        console.error('[desktop-bridge] unable to open pairing window', error)
      })
      return
    }
    if (!bridge.pluginConfigOpen) return
    void bridge.pluginConfigOpen({ plugin: id }).catch((error: unknown) => {
      console.error(`[desktop-bridge] unable to open ${id} config`, error)
    })
  }
  const hover = (kind: 'enter' | 'leave'): ((e: { currentTarget: HTMLElement }) => void) => {
    return (e: { currentTarget: HTMLElement }) => {
      e.currentTarget.style.background =
        kind === 'enter' ? 'var(--dsw-alias-hover,#ffffff14)' : 'transparent'
    }
  }
  return h(
    'button',
    {
      type: 'button',
      'aria-label': label,
      title: label,
      onClick: openAction,
      style: wide === false ? { ...STYLE.entryBtn, ...STYLE.entryBtnRail } : STYLE.entryBtn,
      onMouseEnter: hover('enter'),
      onMouseLeave: hover('leave'),
    },
    h(
      'span',
      { style: STYLE.icon, 'aria-hidden': true },
      h('svg', { viewBox: '0 0 24 24', width: 17, height: 17, fill: 'none' }, ...(ICONS[id] ?? [])),
      open === 'pair' && connected ? h('i', { style: STYLE.dot, 'aria-hidden': true }) : null,
    ),
    wide === false ? null : h('span', { style: STYLE.label }, label),
  )
}

export const name = '@dsh/plugin-desktop-bridge'
export const inject = ['slots', 'locale']

export function apply(ctx: BridgeClientContext): void {
  const locale = languageOf(ctx)
  const bridgeAvailable =
    typeof window !== 'undefined' &&
    (typeof window.dshDesktop?.pluginConfigOpen === 'function' ||
      typeof window.dshDesktop?.mobileOpenPairing === 'function')
  if (!bridgeAvailable) return
  ctx.slots.inject('sidebar.footer.action', () => {
    for (let i = 0; i < ACTIONS.length; i += 1) {
      const entry = ACTIONS[i]
      ctx.slots.register(
        {
          name: 'sidebar.footer.action',
          id: `dsh-desktop-config-${entry.id}`,
          order: 30 + i,
          label: () => (locale === 'zh' ? entry.zh : entry.en),
        },
        (props: Record<string, unknown>) =>
          h(FooterAction, {
            ...(props as { wide?: boolean }),
            ...entry,
            locale,
          }),
      )
    }
  })
}
