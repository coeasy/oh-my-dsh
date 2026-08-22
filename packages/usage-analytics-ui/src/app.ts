/**
 * Mount layer: injects the shared UI into a container, wires the injected host
 * bridge, provides simple client-side routing and live updates via the event
 * bus. This is the only DOM-touching part of the shared bundle.
 */

import type { UIBridge, Route } from './bridge.ts'
import { getBridge } from './bridge.ts'
import { ROUTES } from './views.ts'
import {
  renderOverview,
  renderTrend,
  renderProviders,
  renderModels,
  renderCache,
  renderSessions,
  renderSettings,
  type OverviewData,
  type TrendPointData,
  type ProviderRowData,
  type ModelRowData,
  type CacheData,
  type EventRowData,
} from './views.ts'

export interface MountOptions {
  container: HTMLElement
  bridge?: UIBridge
  costEnabled?: boolean
}

export class UsageAnalyticsApp {
  private container: HTMLElement
  private bridge: UIBridge | null
  private costEnabled: boolean
  private currentRoute: Route = 'overview'
  private unsubs: Array<() => void> = []
  private refreshTimer: ReturnType<typeof setInterval> | null = null

  constructor(opts: MountOptions) {
    this.container = opts.container
    this.bridge = opts.bridge ?? getBridge() ?? null
    this.costEnabled = opts.costEnabled ?? false
  }

  private async render(): Promise<void> {
    if (!this.bridge) {
      this.container.innerHTML =
        '<div class="qa-card">Usage Analytics is not connected to a host. Install/enable the plugin and relaunch.</div>'
      return
    }
    const range = { range: 'today' as const }
    let html = ''
    // view-driven contract: the host returns the single data block for the
    // requested view (dispatchUsageAnalyticsAction), not an aggregate object.
    switch (this.currentRoute) {
      case 'overview': {
        const res = await this.bridge.query({ view: 'overview', ...range })
        html = renderOverview((res.data as OverviewData) ?? ({} as OverviewData), this.costEnabled)
        break
      }
      case 'trend': {
        const res = await this.bridge.query({ view: 'trend', ...range })
        html = renderTrend((res.data as TrendPointData[]) ?? [])
        break
      }
      case 'providers': {
        const res = await this.bridge.query({ view: 'providers', ...range })
        html = renderProviders((res.data as ProviderRowData[]) ?? [], this.costEnabled)
        break
      }
      case 'models': {
        const res = await this.bridge.query({ view: 'models', ...range })
        html = renderModels((res.data as ModelRowData[]) ?? [])
        break
      }
      case 'cache': {
        const res = await this.bridge.query({ view: 'cache', ...range })
        html = renderCache((res.data as CacheData) ?? ({} as CacheData))
        break
      }
      case 'sessions': {
        const res = await this.bridge.query({ view: 'events', ...range })
        html = renderSessions((res.data as EventRowData[]) ?? [])
        break
      }
      case 'settings': {
        const caps = this.bridge.getCapabilities()
        const res = await this.bridge.query({ view: 'settings', ...range })
        html = renderSettings(caps, res.data)
        break
      }
    }
    this.container.innerHTML = `<nav class="qa-nav">${this.navHtml()}</nav>${html}`
    this.bindNav()
  }

  private navHtml(): string {
    const items = (ROUTES as readonly Route[])
      .map(
        (r) =>
          `<button class="qa-nav-btn ${r === this.currentRoute ? 'active' : ''}" data-route="${r}">${r}</button>`,
      )
      .join('')
    return items
  }

  private bindNav(): void {
    this.container.querySelectorAll<HTMLButtonElement>('.qa-nav-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.currentRoute = (btn.dataset.route as Route) ?? 'overview'
        void this.render()
      })
    })
  }

  mount(): void {
    this.container.innerHTML = '<div class="qa-card">Loading…</div>'
    if (this.bridge) {
      this.unsubs.push(
        this.bridge.subscribe('usage.aggregate.updated', () => this.debouncedRefresh()),
      )
      this.unsubs.push(this.bridge.subscribe('usage.event.created', () => this.debouncedRefresh()))
    }
    this.refreshTimer = setInterval(() => void this.render(), 15_000)
    void this.render()
  }

  private lastRefresh = 0
  private debouncedRefresh(): void {
    const now = Date.now()
    if (now - this.lastRefresh < 1000) return
    this.lastRefresh = now
    void this.render()
  }

  destroy(): void {
    for (const un of this.unsubs) un()
    this.unsubs = []
    if (this.refreshTimer) clearInterval(this.refreshTimer)
    this.refreshTimer = null
  }
}

/** Convenience: build and mount in one call. */
export function mountUsageAnalytics(opts: MountOptions): UsageAnalyticsApp {
  const app = new UsageAnalyticsApp(opts)
  app.mount()
  return app
}
