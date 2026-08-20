import type { RuntimePhase, RuntimeSnapshot } from './contracts.ts'

export interface TrayMenuLabels {
  show: string
  market: string
  restart: string
  quit: string
}

const PHASE_LABEL: Record<'en' | 'zh', Record<RuntimePhase, string>> = {
  en: {
    idle: 'Idle',
    starting: 'Starting',
    ready: 'Running',
    stopping: 'Stopping',
    failed: 'Failed',
  },
  zh: {
    idle: '未运行',
    starting: '正在启动',
    ready: '运行中',
    stopping: '正在退出',
    failed: '启动失败',
  },
}

/** Tooltip / title for the desktop status tray. */
export function trayTooltip(snapshot: RuntimeSnapshot, locale: 'en' | 'zh'): string {
  const phase = PHASE_LABEL[locale][snapshot.phase]
  return `my-dsh · ${phase}`
}

/** Tray context-menu labels for show, restart, and quit. */
export function trayMenuLabels(locale: 'en' | 'zh'): TrayMenuLabels {
  if (locale === 'zh') {
    return { show: '打开窗口', market: '插件市场', restart: '重启', quit: '退出' }
  }
  return { show: 'Open Window', market: 'Marketplace', restart: 'Restart', quit: 'Quit' }
}
