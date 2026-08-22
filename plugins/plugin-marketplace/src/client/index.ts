/**
 * @coeasy/dsh-plugin-marketplace client: registers a "插件市场 / Marketplace"
 * settings section. Built by tsdown into the __ModuleLoader__ factory bundle.
 * Rendering uses native elements + dsw theme tokens (no ui-primitives dep, so
 * the section can never blank the settings dialog on older hosts).
 *
 * UX decisions (from plan v0.3): click-to-install (no confirm dialog), a
 * material prompt is skippable, and the section is a first-class nav entry.
 */

import { createElement as h, useCallback, useEffect, useRef, useState } from 'react'

const API = '/coeasy-market/api'

type MarketActionKind =
  | 'install'
  | 'update'
  | 'remove'
  | 'toggle'
  | 'restore'
  | 'sync'
  | 'uninstall-market'
  | 'uninstall-app'

const brokerPending = new Map<
  string,
  { resolve(value: Row): void; reject(error: Error): void; timer: number }
>()

if (typeof window !== 'undefined') {
  window.addEventListener('message', (event) => {
    const data = event.data as {
      channel?: unknown
      requestId?: unknown
      result?: unknown
      error?: unknown
    }
    if (data?.channel !== 'dsh-market-response' || typeof data.requestId !== 'string') return
    const pending = brokerPending.get(data.requestId)
    if (!pending) return
    brokerPending.delete(data.requestId)
    window.clearTimeout(pending.timer)
    if (typeof data.error === 'string' && data.error) pending.reject(new Error(data.error))
    else pending.resolve((data.result ?? {}) as Row)
  })
}

async function marketAction(
  kind: MarketActionKind,
  payload: Record<string, unknown>,
): Promise<Row> {
  if (typeof window === 'undefined') throw new Error('trusted marketplace host is unavailable')
  if (window.dshDesktop?.marketAction) {
    return (await window.dshDesktop.marketAction({ kind, payload })) as Row
  }
  if (window.parent === window) throw new Error('trusted marketplace host is unavailable')
  const requestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
  return new Promise<Row>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      brokerPending.delete(requestId)
      reject(new Error('trusted marketplace host timed out'))
    }, 310_000)
    brokerPending.set(requestId, { resolve, reject, timer })
    window.parent.postMessage({ channel: 'dsh-market-request', requestId, kind, payload }, '*')
  })
}

const dict = {
  zh: {
    nav: '插件市场',
    search: '搜索插件 / 仓库 / 标签…',
    refresh: '刷新',
    all: '全部',
    builtin: '内置',
    curated: '精选',
    installed: '已安装',
    install: '安装',
    installing: '安装中…',
    remove: '移除',
    update: '更新',
    enable: '启用',
    disable: '禁用',
    stars: '星',
    output: '命令输出',
    empty: '没有匹配的插件',
    mineEmpty: '还没有安装任何插件，去“全部”里逛逛',
    loadError: '加载失败，请重试',
    loading: '正在加载插件目录',
    loadingSources: '正在加载数据源',
    offline: '在线数据源暂不可用，当前显示内置快照',
    retry: '重试',
    loadMore: '加载更多',
    stageVerifying: '正在执行安装前安全校验…',
    stageInstalling: '正在通过官方 CLI 安装…',
    stageRefreshing: '正在刷新安装状态…',
    officialNote: '安装与移除均走官方 dsh plugin 命令，可用官方 CLI 同步管理。',
    detail: '详情',
    type: '类型',
    license: '许可',
    updated: '更新于',
    skip: '跳过',
    submit: '提交',
    needKey: '该插件可能需要 API Key/Token，可稍后在官方命令中配置：',
    readmeError: '无法加载 README',
    confirmTitle: '确认操作',
    confirmInstall: '确认安装',
    confirmUpdate: '确认更新',
    confirmRemove: '确认移除',
    cancel: '取消',
    source: '来源',
    profile: 'Profile',
    spec: '规格',
    security: '安全检查',
    lifecycleWarn:
      '该包安装时会执行生命周期脚本（install/preinstall/postinstall/prepare），请确认可信',
    squatWarn: 'npm 仓库地址与所选来源不一致，疑似改名或占用，请谨慎',
    secure: '未发现安全风险',
    verifyNone: '（非 npm 包，跳过校验）',
    tarballMatch: '已校验 tarball 与 registry integrity 一致',
    tarballMismatch: 'tarball 完整性校验失败（疑似篡改），安装已被拒绝',
    tarballUnavailable: 'tarball 校验暂不可用（网络受限），已放行至官方 CLI',
    publisherUnknown: '发布者不在已知白名单，请自行确认可信',
    backup: '备份已装插件',
    restore: '恢复备份',
    diagnose: '诊断',
    exportDone: '已导出备份（复制下方 JSON 保存）',
    restorePrompt: '粘贴备份 JSON 后点击恢复',
    restoreDone: '恢复完成',
    restorePartial: '部分恢复失败，见输出',
    diagnosePanel: '诊断信息',
    close: '关闭',
    noBackup: '尚未导出备份',
    backupJson: '备份 JSON',
    restoreBtn: '开始恢复',
    info: '详情',
    infoHide: '收起详情',
    pkg: '包名',
    repo: '仓库',
    specLabel: '安装规格',
    noLicense: '无许可',
    updatedAt: '更新于',
    link: '链接',
    manage: '管理',
    notActive: '已安装未生效',
    repair: '修复',
    restartHint: '插件已注册，重启客户端后生效。',
    homes: '目录同步',
    homesPrimary: '主目录',
    homesMirror: '镜像',
    homesInSync: '已同步',
    homesMissing: '缺少插件',
    homesDrifted: '版本不同',
    homesExtra: '含额外插件',
    homesSync: '同步全部目录',
    homesSyncing: '正在同步目录…',
    homesSynced: '目录同步完成',
    homesSyncPartial: '部分目录同步失败，见输出',
    homesNote: '安装/更新/移除会同步到主目录与各镜像目录（官方 dsh 命令幂等重放）。',
    homesDep: '依赖',
    homesBundle: '层',
    homesMissingOf: '缺少',
    homesExtraOf: '额外',
  },
  en: {
    nav: 'Marketplace',
    search: 'Search plugins / repos / topics…',
    refresh: 'Refresh',
    all: 'All',
    builtin: 'Built-in',
    curated: 'Curated',
    installed: 'Installed',
    install: 'Install',
    installing: 'Installing…',
    remove: 'Remove',
    update: 'Update',
    enable: 'Enable',
    disable: 'Disable',
    stars: 'stars',
    output: 'Command output',
    empty: 'No matching plugins',
    mineEmpty: 'Nothing installed yet — browse the full catalog',
    loadError: 'Failed to load, retry',
    loading: 'Loading plugin catalog',
    loadingSources: 'Loading data sources',
    offline: 'Online sources unavailable — showing built-in snapshot',
    retry: 'Retry',
    loadMore: 'Load more',
    stageVerifying: 'Running pre-install security checks…',
    stageInstalling: 'Installing via the official CLI…',
    stageRefreshing: 'Refreshing install state…',
    officialNote: 'Installs & removals go through the official dsh plugin command.',
    detail: 'Details',
    type: 'Type',
    license: 'License',
    updated: 'Updated',
    skip: 'Skip',
    submit: 'Submit',
    needKey: 'This plugin may need an API Key/Token — configure it later via the official command:',
    readmeError: 'Cannot load README',
    confirmTitle: 'Confirm',
    confirmInstall: 'Confirm install',
    confirmUpdate: 'Confirm update',
    confirmRemove: 'Confirm remove',
    cancel: 'Cancel',
    source: 'Source',
    profile: 'Profile',
    spec: 'Spec',
    security: 'Security check',
    lifecycleWarn:
      'This package runs lifecycle scripts (install/preinstall/postinstall/prepare) on install — verify it is trusted',
    squatWarn:
      'npm repository differs from the selected source — possible rename/hijack, proceed with care',
    secure: 'No security risk detected',
    verifyNone: '(non-npm spec, skipped)',
    tarballMatch: 'Tarball verified against registry integrity',
    tarballMismatch: 'Tarball integrity mismatch (possible tampering) — install refused',
    tarballUnavailable:
      'Tarball check unavailable (network restricted); deferred to the official CLI',
    publisherUnknown: 'Publisher is not on the known allowlist — verify trust yourself',
    backup: 'Backup installed',
    restore: 'Restore backup',
    diagnose: 'Diagnose',
    exportDone: 'Backup exported — copy the JSON below',
    restorePrompt: 'Paste backup JSON then restore',
    restoreDone: 'Restore complete',
    restorePartial: 'Some restores failed, see output',
    diagnosePanel: 'Diagnostics',
    close: 'Close',
    noBackup: 'No backup exported yet',
    backupJson: 'Backup JSON',
    restoreBtn: 'Restore',
    info: 'Details',
    infoHide: 'Hide details',
    pkg: 'Package',
    repo: 'Repo',
    specLabel: 'Spec',
    noLicense: 'no license',
    updatedAt: 'Updated',
    link: 'Link',
    manage: 'Manage',
    notActive: 'Installed, not active',
    repair: 'Repair',
    restartHint: 'Plugin registered — restart the client to apply.',
    homes: 'Home sync',
    homesPrimary: 'Primary',
    homesMirror: 'Mirror',
    homesInSync: 'In sync',
    homesMissing: 'Missing plugins',
    homesDrifted: 'Version differs',
    homesExtra: 'Has extra plugins',
    homesSync: 'Sync all homes',
    homesSyncing: 'Syncing homes…',
    homesSynced: 'Homes in sync',
    homesSyncPartial: 'Some homes failed to sync, see output',
    homesNote:
      'Install/update/remove is replayed to the primary and every mirror (idempotent official dsh).',
    homesDep: 'Deps',
    homesBundle: 'Layers',
    homesMissingOf: 'Missing',
    homesExtraOf: 'Extra',
  },
} as const
type Locale = keyof typeof dict

type Row = Record<string, unknown>

interface SlotsService {
  inject(slot: string, register: () => unknown): void
  register(
    meta: Record<string, unknown>,
    component: (props: Record<string, unknown>) => unknown,
  ): unknown
}
interface LocaleService {
  register(ns: string, d: Record<string, Record<string, string>>): () => void
  bind(ns: string): (k: string) => string
  language?: string
}
interface MarketClientContext {
  effect(callback: () => unknown, label?: string): void
  locale: LocaleService
  slots: SlotsService
}

function languageOf(ctx: MarketClientContext): Locale {
  const lang = ctx.locale.language ?? (typeof navigator !== 'undefined' ? navigator.language : 'en')
  return typeof lang === 'string' && lang.startsWith('zh') ? 'zh' : 'en'
}

/**
 * Style tokens — every color uses a REAL dsw alias variable (see
 * ui-theme/design-platform.css: body + body[data-ds-dark-theme]), so the
 * market follows the app's light/dark theme automatically. Fallbacks are
 * OPAQUE neutrals, so even a host without the theme sheet renders a solid,
 * readable panel — never the old semi-transparent black.
 *
 * Layering (theme-native):
 *   modal/dialog  → bg-base (sits above the overlay mask)
 *   cards, inputs → bg-layer-1 / bg-layer-2
 *   code/output   → bg-layer-3
 */
const T = {
  // surface tokens
  base: 'var(--dsw-alias-bg-base,#17181a)',
  layer1: 'var(--dsw-alias-bg-layer-1,#1f2124)',
  layer2: 'var(--dsw-alias-bg-layer-2,#26282c)',
  layer3: 'var(--dsw-alias-bg-layer-3,#2e3136)',
  border: 'var(--dsw-alias-border-l2,#3a3d42)',
  borderSoft: 'var(--dsw-alias-border-l1,#2c2f34)',
  // text tokens
  text: 'var(--dsw-alias-label-primary,#e8eaed)',
  text2: 'var(--dsw-alias-label-secondary,#b7bcc4)',
  textDim: 'var(--dsw-alias-label-dimmed,#8a9099)',
  textOnAccent: 'var(--dsw-alias-label-primary-foreground,#ffffff)',
  // interaction tokens
  accent: 'var(--dsw-alias-brand-primary,#4d6bfe)',
  accentText: 'var(--dsw-alias-brand-primary-invert,#ffffff)',
  primaryFill: 'var(--dsw-alias-button-primary-fill,#4d6bfe)',
  primaryHover: 'var(--dsw-alias-button-primary-hover,#3d5bf0)',
  hover: 'var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,0.07))',
  overlay: 'var(--dsw-alias-bg-overlay,rgba(0,0,0,0.55))',
  ok: 'var(--dsw-static-green-500,#22c55e)',
  warn: 'var(--dsw-static-amber-500,#f59e0b)',
} as const

const S = {
  wrap: { display: 'flex', flexDirection: 'column', gap: '10px' },
  toolbar: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' as const },
  search: {
    flex: '1',
    minWidth: '160px',
    padding: '7px 12px',
    borderRadius: '8px',
    border: `1px solid ${T.border}`,
    background: T.layer2,
    color: T.text,
    fontSize: '13px',
    outline: 'none',
  },
  btn: {
    padding: '6px 14px',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '13px',
    border: `1px solid ${T.border}`,
    background: T.layer2,
    color: T.text,
  },
  btnPrimary: {
    padding: '6px 14px',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '13px',
    border: 'none',
    background: T.primaryFill,
    color: T.textOnAccent,
  },
  cardBtn: {
    padding: '4px 10px',
    borderRadius: '7px',
    cursor: 'pointer',
    fontSize: '12px',
    border: `1px solid ${T.border}`,
    background: T.layer2,
    color: T.text,
    whiteSpace: 'nowrap' as const,
  },
  cardBtnPrimary: {
    padding: '4px 10px',
    borderRadius: '7px',
    cursor: 'pointer',
    fontSize: '12px',
    border: 'none',
    background: T.primaryFill,
    color: T.textOnAccent,
    whiteSpace: 'nowrap' as const,
  },
  chip: {
    padding: '3px 10px',
    borderRadius: '14px',
    cursor: 'pointer',
    fontSize: '12px',
    border: `1px solid ${T.border}`,
    background: 'transparent',
    color: T.text2,
  },
  chipOn: {
    padding: '3px 10px',
    borderRadius: '14px',
    cursor: 'pointer',
    fontSize: '12px',
    border: 'none',
    background: T.accent,
    color: T.textOnAccent,
  },
  /** Compact two-column plugin grid (user preference: dense browsing). */
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))',
    gap: '8px',
  },
  card: {
    display: 'flex',
    gap: '10px',
    alignItems: 'flex-start',
    padding: '10px 12px',
    borderRadius: '10px',
    border: `1px solid ${T.borderSoft}`,
    background: T.layer1,
  },
  cardMain: { flex: '1', display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '0' },
  title: {
    fontWeight: 600,
    fontSize: '13px',
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    flexWrap: 'wrap' as const,
    cursor: 'pointer',
    color: T.text,
  },
  desc: {
    fontSize: '12px',
    color: T.text2,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  meta: { fontSize: '11px', color: T.textDim },
  stars: { fontSize: '12px', fontWeight: 600, color: T.accent, whiteSpace: 'nowrap' as const },
  badge: {
    fontSize: '10px',
    padding: '1px 6px',
    borderRadius: '6px',
    background: T.accent,
    color: T.textOnAccent,
  },
  badgeGreen: {
    fontSize: '10px',
    padding: '1px 6px',
    borderRadius: '6px',
    background: T.ok,
    color: '#fff',
  },
  badgeGray: {
    fontSize: '10px',
    padding: '1px 6px',
    borderRadius: '6px',
    background: T.layer3,
    color: T.text2,
  },
  note: { fontSize: '11px', color: T.textDim },
  output: {
    fontSize: '11px',
    whiteSpace: 'pre-wrap' as const,
    fontFamily: 'monospace',
    maxHeight: '180px',
    overflow: 'auto',
    padding: '8px',
    borderRadius: '8px',
    background: T.layer3,
    color: T.text2,
  },
  detail: {
    fontSize: '12px',
    whiteSpace: 'pre-wrap' as const,
    maxHeight: '240px',
    overflow: 'auto',
    color: T.text2,
    padding: '6px 2px',
  },
  /** Confirmation dialog. */
  overlay: {
    position: 'fixed' as const,
    inset: '0',
    background: T.overlay,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },
  modal: {
    width: 'min(560px, 92vw)',
    maxHeight: '86vh',
    overflow: 'auto',
    padding: '16px',
    borderRadius: '12px',
    background: T.base,
    border: `1px solid ${T.border}`,
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    color: T.text,
  },
  modalTitle: { fontWeight: 600, fontSize: '14px' },
  modalRow: { fontSize: '12px', display: 'flex', gap: '6px', flexWrap: 'wrap' as const },
  modalLabel: { color: T.textDim },
  warn: {
    fontSize: '12px',
    padding: '8px 10px',
    borderRadius: '8px',
    background: 'rgba(245,158,11,0.12)',
    border: '1px solid rgba(245,158,11,0.5)',
    color: T.warn,
    whiteSpace: 'pre-wrap' as const,
  },
  danger: {
    fontSize: '12px',
    padding: '8px 10px',
    borderRadius: '8px',
    background: 'rgba(220,38,38,0.12)',
    border: '1px solid rgba(220,38,38,0.55)',
    color: '#f87171',
    whiteSpace: 'pre-wrap' as const,
  },
  okline: {
    fontSize: '12px',
    padding: '6px 10px',
    borderRadius: '8px',
    background: 'rgba(34,197,94,0.12)',
    border: '1px solid rgba(34,197,94,0.5)',
    color: T.ok,
  },
  modalActions: { display: 'flex', gap: '8px', justifyContent: 'flex-end' },
  textarea: {
    width: '100%',
    minHeight: '120px',
    fontSize: '11px',
    fontFamily: 'monospace',
    borderRadius: '8px',
    padding: '8px',
    border: `1px solid ${T.border}`,
    background: T.layer2,
    color: T.text,
  },
  manage: { marginTop: '2px' },
  manageSummary: {
    cursor: 'pointer',
    fontSize: '12px',
    color: T.text2,
    fontWeight: 500,
    userSelect: 'none' as const,
    padding: '4px 0',
  },
  moreBtn: {
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    fontSize: '16px',
    lineHeight: '1',
    color: T.text2,
    padding: '2px 6px',
    borderRadius: '6px',
  },
  manageOverlay: {
    position: 'fixed' as const,
    inset: '0',
    background: 'rgba(0,0,0,0.35)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  manageModal: {
    background: T.layer1,
    border: `1px solid ${T.border}`,
    borderRadius: '12px',
    boxShadow: '0 8px 30px rgba(0,0,0,0.2)',
    padding: '16px',
    width: 'min(560px, 90vw)',
    maxHeight: '80vh',
    overflow: 'auto',
    boxSizing: 'border-box' as const,
  },
  manageModalHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '10px',
  },
  manageTitle: { fontWeight: 600, fontSize: '14px' },
  closeBtnSmall: {
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    fontSize: '14px',
    color: T.text2,
  },
  tool: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    flexWrap: 'wrap' as const,
    padding: '8px 12px',
    borderRadius: '10px',
    border: `1px dashed ${T.border}`,
    background: T.layer1,
  },
  diag: {
    fontSize: '12px',
    whiteSpace: 'pre-wrap' as const,
    maxHeight: '300px',
    overflow: 'auto',
    padding: '10px',
    borderRadius: '8px',
    background: T.layer3,
    color: T.text2,
  },
  loading: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 2px',
  },
  spinner: {
    width: '14px',
    height: '14px',
    border: `2px solid ${T.border}`,
    borderTopColor: T.accent,
    borderRadius: '50%',
    animation: 'coeasy-spin 0.8s linear infinite',
  },
  loadingText: { fontSize: '12px', color: T.text2 },
  offline: {
    fontSize: '12px',
    padding: '8px 10px',
    borderRadius: '8px',
    background: 'rgba(245,158,11,0.12)',
    border: '1px solid rgba(245,158,11,0.5)',
    color: T.warn,
  },
  skeleton: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  skeletonCard: {
    height: '68px',
    borderRadius: '10px',
    background: T.layer2,
    opacity: 0.6,
  },
  /** Sidebar home entry (both widths). */
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
    color: T.text,
    background: 'transparent',
    textAlign: 'left' as const,
  },
  entryBtnRail: { justifyContent: 'center', padding: '8px 0' },
  entryBtnHover: { background: T.hover },
  entryIcon: { fontSize: '15px', lineHeight: '1' },
  entryLabel: { flex: '1', whiteSpace: 'nowrap' as const, overflow: 'hidden' },
  entryBadge: {
    fontSize: '10px',
    padding: '1px 6px',
    borderRadius: '6px',
    background: T.accent,
    color: T.textOnAccent,
  },
  /** Centered large market dialog (home entry). */
  overlayFull: {
    position: 'fixed' as const,
    inset: '0',
    background: T.overlay,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2000,
  },
  marketPanel: {
    width: 'min(1080px, 92vw)',
    maxHeight: '88vh',
    display: 'flex',
    flexDirection: 'column',
    borderRadius: '14px',
    background: T.base,
    border: `1px solid ${T.border}`,
    overflow: 'hidden',
    color: T.text,
    boxShadow: '0 24px 64px rgba(0,0,0,0.35)',
  },
  marketHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '12px 16px',
    borderBottom: `1px solid ${T.borderSoft}`,
  },
  marketTitle: { fontWeight: 600, fontSize: '14px', flex: '1' },
  marketBody: { padding: '14px 16px', overflow: 'auto' },
  closeBtn: {
    padding: '4px 10px',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '16px',
    border: `1px solid ${T.border}`,
    background: T.layer2,
    color: T.text,
    lineHeight: '1',
  },
}

/**
 * C1 three-state security summary for the confirm dialog. Each verify facet
 * maps to one line: danger (tarball mismatch — install refused by the host),
 * warn (lifecycle scripts / squat / unknown publisher), ok (tarball verified,
 * all clear) or a neutral note (check unavailable).
 */
function securityLines(
  verify: Row,
  t: (k: keyof (typeof dict)['zh']) => string,
): Array<{ text: string; danger?: boolean; warn?: boolean; ok?: boolean }> {
  const lines: Array<{ text: string; danger?: boolean; warn?: boolean; ok?: boolean }> = []
  const tarballCheck = String(verify.tarballCheck ?? '')
  if (tarballCheck === 'match') lines.push({ text: t('tarballMatch'), ok: true })
  else if (tarballCheck === 'mismatch') lines.push({ text: t('tarballMismatch'), danger: true })
  else if (tarballCheck === 'unavailable') lines.push({ text: t('tarballUnavailable') })
  const lifecycle = (verify.lifecycle as string[]) ?? []
  if (lifecycle.length > 0) {
    lines.push({ text: `${t('lifecycleWarn')}\n(${lifecycle.join(', ')})`, warn: true })
  }
  if (verify.squat === true) lines.push({ text: t('squatWarn'), warn: true })
  if (verify.publisherKnown === false && verify.maintainers) {
    lines.push({ text: t('publisherUnknown'), warn: true })
  }
  if (lines.length === 0) lines.push({ text: t('secure'), ok: true })
  return lines
}

function MarketSection({ locale }: { locale: Locale }): ReturnType<typeof h> {
  const t = (k: keyof (typeof dict)['zh']): string => dict[locale][k]
  const [repos, setRepos] = useState<Row[] | null>(null)
  const [categories, setCategories] = useState<string[]>([])
  const [sources, setSources] = useState<Row[]>([])
  const [source, setSource] = useState('all')
  const [cat, setCat] = useState('全部')
  // P0-4: “已安装” view filter — show only installed cards.
  const [mine, setMine] = useState(false)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [output, setOutput] = useState('')
  const [open, setOpen] = useState<Record<string, string>>({})
  const [showInfo, setShowInfo] = useState<Record<string, boolean>>({})
  const [profile, setProfile] = useState('')
  const [confirm, setConfirm] = useState<{
    kind: 'install' | 'update' | 'remove'
    spec: string
    fullName: string
    type: string
    source: string
    verify: Row | null
    verifying: boolean
  } | null>(null)
  const [backupJson, setBackupJson] = useState('')
  const [diag, setDiag] = useState('')
  const [progress, setProgress] = useState('')
  const [manageOpen, setManageOpen] = useState(false)
  const [homes, setHomes] = useState<Row[] | null>(null)
  const [homesSyncing, setHomesSyncing] = useState(false)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [total, setTotal] = useState(0)
  const loadAbort = useRef<AbortController | null>(null)

  const load = useCallback(
    async (refresh: boolean, nextPage = 1, append = false) => {
      loadAbort.current?.abort()
      const controller = new AbortController()
      loadAbort.current = controller
      if (!append) {
        setProgress(dict[locale].loading)
        setRepos(null)
      }
      try {
        const params = new URLSearchParams({
          source,
          page: String(nextPage),
          page_size: '50',
        })
        if (query.trim()) params.set('q', query.trim())
        if (refresh) params.set('refresh', '1')
        // P0-4: in the “已安装” view ask the server to filter the FULL catalog
        // (installed cards are not star-sorted into the first page).
        if (mine) params.set('installed_only', '1')
        const res = await fetch(`${API}/list?${params.toString()}`, {
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!res.ok) throw new Error(`catalog HTTP ${res.status}`)
        const body = (await res.json()) as {
          repos?: Row[]
          categories?: string[]
          sources?: Row[]
          profile?: string
          page?: number
          total?: number
          hasMore?: boolean
        }
        const incoming = Array.isArray(body.repos) ? body.repos : []
        setRepos((current) => {
          if (!append) return incoming
          const byName = new Map((current ?? []).map((row) => [String(row.full_name), row]))
          for (const row of incoming) byName.set(String(row.full_name), row)
          return [...byName.values()]
        })
        if (typeof body.profile === 'string') setProfile(body.profile)
        if (Array.isArray(body.categories)) setCategories(body.categories)
        if (Array.isArray(body.sources)) {
          setSources((current) => {
            const byId = new Map(current.map((row) => [String(row.id), row]))
            for (const row of body.sources ?? []) byId.set(String(row.id), row)
            return [...byId.values()]
          })
        }
        setPage(Number.isFinite(body.page) ? Number(body.page) : nextPage)
        setTotal(Number.isFinite(body.total) ? Number(body.total) : incoming.length)
        setHasMore(body.hasMore === true)
      } catch (error) {
        if (controller.signal.aborted) return
        setRepos((current) => current ?? [])
        setHasMore(false)
        setOutput(error instanceof Error ? error.message : String(error))
      } finally {
        if (loadAbort.current === controller) {
          loadAbort.current = null
          setProgress('')
        }
      }
    },
    [locale, query, source, mine],
  )

  // Debounce full-index search and abort superseded source/query requests.
  useEffect(() => {
    const timer = window.setTimeout(() => void load(false), query.trim() ? 250 : 0)
    return () => {
      window.clearTimeout(timer)
      loadAbort.current?.abort()
    }
  }, [load])

  const pickSource = (s: string) => {
    setSource(s)
  }

  // Multi-home sync matrix: read the primary + mirror consistency view.
  // Defined BEFORE `act` because act's dependency array references it.
  const loadHomes = useCallback(async () => {
    try {
      const r = await fetch(`${API}/homes`, { cache: 'no-store' })
      const b = (await r.json()) as { homes?: Row[] }
      setHomes(Array.isArray(b.homes) ? b.homes : [])
    } catch {
      setHomes([])
    }
  }, [])

  const act = useCallback(
    async (kind: string, payload: Record<string, string>, key: string) => {
      setBusy(key)
      setOutput('')
      // D1: staged feedback — verify → install → refresh, so the wait is never
      // a black box while the official CLI runs.
      const installing = kind === 'install' || kind === 'update'
      setProgress(installing ? t('stageVerifying') : t('stageInstalling'))
      try {
        if (installing) setProgress(t('stageInstalling'))
        const body = (await marketAction(kind as MarketActionKind, payload)) as {
          ok?: boolean
          output?: string
          error?: string
          restartRequired?: boolean
          mirrors?: Row[]
          mirrorNote?: string
        }
        const hint =
          body.ok && body.restartRequired === true && (kind === 'install' || kind === 'update')
            ? `\n\n${t('restartHint')}`
            : ''
        // Mirror replay results (multi-home sync) appended to the output.
        let mirrorLines = ''
        const mirrorFailures = (body.mirrors ?? []).filter((m) => m.ok !== true)
        if (Array.isArray(body.mirrors) && body.mirrors.length > 0) {
          mirrorLines = `\n\n[${t('homes')}]\n`
          for (const m of body.mirrors as Row[]) {
            mirrorLines += `  ${m.ok ? 'OK' : 'FAIL'}  ${String(m.path)}${m.ok ? '' : `  ${String(m.error ?? '')}`}\n`
          }
          if (mirrorFailures.length > 0) mirrorLines += `${t('homesSyncPartial')}\n`
        }
        setOutput(
          `${body.output ?? body.error ?? `${kind} → ${body.ok ? 'OK' : 'FAIL'}`}${hint}${mirrorLines}`,
        )
        if (body.ok) {
          setProgress(t('stageRefreshing'))
          await load(false)
          if (Array.isArray(body.mirrors) && body.mirrors.length > 0) void loadHomes()
        }
      } catch (e) {
        setOutput(String(e))
      } finally {
        setProgress('')
        setBusy(null)
      }
    },
    [load, loadHomes],
  )

  const sourceLabel = (id: string): string => {
    const found = sources.find((s) => String(s.id) === id)
    return found ? String(found.label ?? id) : id
  }

  const openConfirm = async (kind: 'install' | 'update' | 'remove', row: Row) => {
    const spec = String(row.installSpec ?? '')
    const isNpm = !/^github:/.test(spec)
    const fullName = String(row.full_name)
    setConfirm({
      kind,
      spec,
      fullName,
      type: String(row.type ?? 'cordis'),
      source: sourceLabel(source),
      verify: null,
      verifying: isNpm,
    })
    if (!isNpm) return
    try {
      const r = await fetch(`${API}/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ spec, full_name: fullName }),
      })
      const b = (await r.json()) as { verify?: Row | null }
      setConfirm((c) => (c ? { ...c, verify: b.verify ?? null, verifying: false } : c))
    } catch {
      setConfirm((c) => (c ? { ...c, verify: null, verifying: false } : c))
    }
  }

  const doConfirm = async () => {
    if (!confirm) return
    const c = confirm
    setConfirm(null)
    if (c.kind === 'remove') {
      await act('remove', { full_name: c.fullName }, c.fullName)
    } else {
      await act(c.kind, { full_name: c.fullName }, c.fullName)
    }
  }

  const doBackup = async () => {
    setOutput('')
    try {
      const r = await fetch(`${API}/backup`, { cache: 'no-store' })
      const b = (await r.json()) as { backup?: unknown }
      const text = JSON.stringify(b.backup ?? {}, null, 2)
      setBackupJson(text)
      setOutput(t('exportDone'))
    } catch (e) {
      setOutput(String(e))
    }
  }

  const doRestore = async () => {
    if (!backupJson.trim()) {
      setOutput(t('noBackup'))
      return
    }
    setOutput('')
    try {
      const backup = JSON.parse(backupJson)
      const b = (await marketAction('restore', { backup })) as {
        restored?: string[]
        failed?: Array<{ pkg: string; error: string }>
        ok?: boolean
        mirrorSummary?: {
          ok?: boolean
          skipped?: boolean
          note?: string
          results?: Row[]
        }
      }
      const ok = (b.failed ?? []).length === 0
      let mirrorLines = ''
      const ms = b.mirrorSummary
      if (ms) {
        mirrorLines = `\n[${t('homes')}] ${ms.note ?? ''}\n`
        for (const r of (ms.results ?? []) as Row[]) {
          mirrorLines += `  ${r.ok ? 'OK' : 'FAIL'}  ${String(r.path)}${r.ok ? '' : `  ${String(r.error ?? '')}`}\n`
        }
      }
      setOutput(
        `${ok ? t('restoreDone') : t('restorePartial')}\n` +
          `restored: ${(b.restored ?? []).join(', ') || '—'}\n` +
          (b.failed ?? []).map((f) => `✗ ${f.pkg}: ${f.error}`).join('\n') +
          mirrorLines,
      )
      if (ms) void loadHomes()
    } catch (e) {
      setOutput(`${t('restorePartial')}\n${String(e)}`)
    }
  }

  const doDiagnose = async () => {
    setDiag('…')
    try {
      const r = await fetch(`${API}/diagnose`, { cache: 'no-store' })
      const b = (await r.json()) as Row
      const lines: string[] = []
      lines.push(`Profile: ${String(b.profile ?? '')}`)
      lines.push(`Dir: ${String(b.profileDir ?? '')}`)
      lines.push(
        `Dependencies: ${String(b.installCount ?? 0)} · Bundles: ${String(b.bundleCount ?? 0)}`,
      )
      lines.push('')
      lines.push('已装插件 / Installed:')
      for (const it of (b.installed as Row[]) ?? []) {
        lines.push(
          `  ${String(it.name)}  [${String(it.type ?? 'unknown')}]${it.inBundles ? ' [bundle]' : ''}  src=${String(it.source ?? '')}  cat=${String(it.category ?? '')}`,
        )
      }
      lines.push('')
      const conf = (b.conflicts as Row) ?? {}
      const manual = (conf.manualOnly as string[]) ?? []
      lines.push(`未匹配来源 / Unmatched: ${manual.length ? manual.join(', ') : '—'}`)
      lines.push('')
      lines.push('加载顺序 / Load order:')
      for (const l of (b.loadOrder as string[]) ?? []) lines.push(`  ${l}`)
      lines.push('')
      lines.push('数据源 / Sources:')
      for (const s of (b.sources as Row[]) ?? []) {
        lines.push(`  ${String(s.id)}: ${String(s.count)} (${String(s.label ?? '')})`)
      }
      setDiag(lines.join('\n'))
    } catch (e) {
      setDiag(String(e))
    }
  }

  // Lazy repair — bring every mirror up to the primary's plugin set.
  const doSyncHomes = async () => {
    setHomesSyncing(true)
    setOutput('')
    try {
      const b = (await marketAction('sync', { force: true })) as {
        ok?: boolean
        skipped?: boolean
        results?: Row[]
        failures?: Row[]
        note?: string
      }
      const lines: string[] = []
      lines.push(b.ok ? t('homesSynced') : t('homesSyncPartial'))
      for (const r of (b.results ?? []) as Row[]) {
        const added = Array.isArray(r.added) ? (r.added as string[]).length : 0
        const updated = Array.isArray(r.updated) ? (r.updated as string[]).length : 0
        const detail = added > 0 ? ` (+${added})` : updated > 0 ? ` (~${updated})` : ''
        const status = r.ok ? `OK${detail}` : `FAIL: ${String(r.error ?? '')}`
        lines.push(`  ${String(r.path)}  ${status}`)
      }
      if ((b.failures ?? []).length > 0) lines.push('', t('homesSyncPartial'))
      setOutput(lines.join('\n'))
      await loadHomes()
    } catch (e) {
      setOutput(String(e))
    } finally {
      setHomesSyncing(false)
    }
  }

  useEffect(() => {
    if (manageOpen) void loadHomes()
  }, [manageOpen, loadHomes])

  const toggleDetail = async (fullName: string) => {
    if (open[fullName]) {
      const o = { ...open }
      delete o[fullName]
      setOpen(o)
      return
    }
    let readme: string = t('readmeError')
    try {
      const r = await fetch(`${API}/detail?full_name=${encodeURIComponent(fullName)}`)
      const b = await r.json()
      if (b.readme) readme = String(b.readme).slice(0, 2000)
    } catch {
      /* keep */
    }
    setOpen((o) => ({ ...o, [fullName]: readme }))
  }

  const onlineSources = sources.filter((s) => String(s.id) !== 'builtin')
  const onlineAllFailed = onlineSources.length > 0 && onlineSources.every((s) => s.ok === false)
  const sorted = [...(repos ?? [])]
    .filter((r) => {
      // P0-4: “已安装” view keeps only installed cards.
      if (mine && !r.installed) return false
      const inCat = cat === '全部' || r.category === cat
      if (!inCat) return false
      if (query === '') return true
      const q = query.toLowerCase()
      const topics = ((r.topics as string[]) ?? []).join(' ').toLowerCase()
      return (
        String(r.name).toLowerCase().includes(q) ||
        String(r.full_name).toLowerCase().includes(q) ||
        topics.includes(q)
      )
    })
    .sort((a, b) => {
      if (a.installed !== b.installed) return a.installed ? -1 : 1
      if (a.curated !== b.curated) return a.curated ? -1 : 1
      return Number(b.stars ?? 0) - Number(a.stars ?? 0)
    })

  return h(
    'div',
    { style: S.wrap },
    h(
      'div',
      { style: S.toolbar },
      h('input', {
        style: S.search,
        value: query,
        type: 'search',
        placeholder: t('search'),
        onChange: (e: { target: { value: string } }) => setQuery(e.target.value),
      }),
      h('button', { style: S.btn, onClick: () => void load(true) }, t('refresh')),
      h(
        'button',
        {
          type: 'button',
          style: S.moreBtn,
          'aria-label': t('manage'),
          title: t('manage'),
          onClick: () => setManageOpen((v) => !v),
        },
        '⋯',
      ),
    ),
    // P0-4: “全部 / 已安装” primary view tabs.
    h(
      'div',
      { style: { ...S.toolbar, gap: '6px' } },
      h('button', { style: !mine ? S.chipOn : S.chip, onClick: () => setMine(false) }, t('all')),
      h(
        'button',
        { style: mine ? S.chipOn : S.chip, onClick: () => setMine(true) },
        t('installed'),
      ),
    ),
    sources.length > 1
      ? h(
          'div',
          { style: S.toolbar },
          sources.map((s) =>
            h(
              'button',
              {
                key: String(s.id),
                style: source === String(s.id) ? S.chipOn : S.chip,
                onClick: () => pickSource(String(s.id)),
              },
              `${String(s.label)} (${String(s.count)})`,
            ),
          ),
        )
      : null,
    categories.length > 0
      ? h(
          'div',
          { style: S.toolbar },
          categories.map((c) =>
            h(
              'button',
              { key: c, style: cat === c ? S.chipOn : S.chip, onClick: () => setCat(c) },
              c,
            ),
          ),
        )
      : null,
    h('div', { style: S.note }, t('officialNote')),
    onlineAllFailed && progress === ''
      ? h(
          'div',
          {
            style: {
              ...S.offline,
              display: 'flex',
              gap: '10px',
              alignItems: 'center',
              flexWrap: 'wrap' as const,
            },
          },
          h('span', { style: { flex: '1' } }, t('offline')),
          h(
            'button',
            {
              style: { ...S.cardBtn, flexShrink: 0 },
              onClick: () => void load(true),
            },
            t('retry'),
          ),
        )
      : null,
    progress !== ''
      ? h(
          'div',
          { style: S.loading },
          h('span', { style: S.spinner, 'aria-hidden': true }),
          h('span', { style: S.loadingText }, progress),
        )
      : null,
    manageOpen
      ? h(
          'div',
          { style: S.manageOverlay, onClick: () => setManageOpen(false) },
          h(
            'div',
            {
              style: S.manageModal,
              onClick: (e: { stopPropagation(): void }) => e.stopPropagation(),
            },
            h(
              'div',
              { style: S.manageModalHeader },
              h('span', { style: S.manageTitle }, t('manage')),
              h(
                'button',
                {
                  type: 'button',
                  style: S.closeBtnSmall,
                  'aria-label': t('close'),
                  onClick: () => setManageOpen(false),
                },
                '✕',
              ),
            ),
            h(
              'div',
              { style: S.tool },
              h('button', { style: S.btn, onClick: () => void doBackup() }, t('backup')),
              h('button', { style: S.btn, onClick: () => void doDiagnose() }, t('diagnose')),
              backupJson !== ''
                ? h('button', { style: S.btn, onClick: () => void doRestore() }, t('restoreBtn'))
                : null,
              h(
                'button',
                {
                  style: { ...S.btn, color: '#fff', background: T.ok, border: 'none' },
                  disabled: homesSyncing,
                  onClick: () => void doSyncHomes(),
                },
                homesSyncing ? t('homesSyncing') : t('homesSync'),
              ),
              h('span', { style: S.note }, `${t('profile')}: ${profile || '—'}`),
            ),
            backupJson !== ''
              ? h('textarea', {
                  style: S.textarea,
                  value: backupJson,
                  onChange: (e: { target: { value: string } }) => setBackupJson(e.target.value),
                })
              : null,
            // Multi-home sync matrix: primary + mirrors with per-home status.
            homes !== null
              ? h(
                  'div',
                  { style: { ...S.detail, marginTop: '6px', maxHeight: '220px' } },
                  h(
                    'div',
                    { style: { fontWeight: 600, fontSize: '12px', marginBottom: '2px' } },
                    t('homes'),
                  ),
                  h('div', { style: { ...S.note, marginBottom: '4px' } }, t('homesNote')),
                  homes.length === 0
                    ? h('div', { style: S.note }, '—')
                    : homes.map((hm) => {
                        const isPrimary = hm.role === 'primary'
                        const missing = (hm.missing as string[]) ?? []
                        const extra = (hm.extra as string[]) ?? []
                        const drifted = (hm.drifted as string[]) ?? []
                        const statusText =
                          hm.status === 'in-sync'
                            ? t('homesInSync')
                            : hm.status === 'missing'
                              ? t('homesMissing')
                              : hm.status === 'drifted'
                                ? t('homesDrifted')
                                : t('homesExtra')
                        const statusColor =
                          hm.status === 'in-sync'
                            ? T.ok
                            : hm.status === 'missing'
                              ? '#f59e0b'
                              : hm.status === 'drifted'
                                ? '#f97316'
                                : T.text2
                        return h(
                          'div',
                          {
                            key: String(hm.path),
                            style: { padding: '6px 0', borderBottom: `1px solid ${T.borderSoft}` },
                          },
                          h(
                            'div',
                            {
                              style: {
                                display: 'flex',
                                gap: '8px',
                                alignItems: 'center',
                                flexWrap: 'wrap' as const,
                              },
                            },
                            h(
                              'span',
                              {
                                style: isPrimary
                                  ? { ...S.badge, background: T.accent, color: '#fff' }
                                  : S.badgeGray,
                              },
                              isPrimary ? t('homesPrimary') : t('homesMirror'),
                            ),
                            h(
                              'span',
                              {
                                style: {
                                  fontSize: '12px',
                                  flex: '1',
                                  wordBreak: 'break-all' as const,
                                },
                              },
                              String(hm.path),
                            ),
                            h(
                              'span',
                              {
                                style: {
                                  fontSize: '11px',
                                  color: statusColor,
                                  whiteSpace: 'nowrap' as const,
                                },
                              },
                              statusText,
                            ),
                          ),
                          h(
                            'div',
                            { style: { ...S.meta, marginTop: '2px' } },
                            `${t('homesDep')}: ${(hm.dependencies as string[])?.length ?? 0} · ${t('homesBundle')}: ${(hm.bundles as string[])?.length ?? 0}` +
                              (missing.length
                                ? ` · ${t('homesMissingOf')}: ${missing.join(', ')}`
                                : '') +
                              (drifted.length
                                ? ` · ${t('homesDrifted')}: ${drifted.join(', ')}`
                                : '') +
                              (extra.length ? ` · ${t('homesExtraOf')}: ${extra.join(', ')}` : ''),
                          ),
                        )
                      }),
                )
              : null,
            diag !== ''
              ? h(
                  'details',
                  { open: true },
                  h('summary', { style: S.note }, t('diagnosePanel')),
                  h('pre', { style: S.diag }, diag),
                )
              : null,
          ),
        )
      : null,
    repos === null
      ? h(
          'div',
          { style: S.skeleton },
          // 列表骨架不重复展示进度文案：顶部 progress 条已承载"正在加载"提示，
          // 这里仅保留骨架卡片，避免启动时出现两个"正在加载目录"。
          h('div', { style: S.skeletonCard }),
          h('div', { style: S.skeletonCard }),
          h('div', { style: S.skeletonCard }),
        )
      : sorted.length === 0
        ? h('div', { style: S.note }, t('empty'))
        : sorted.map((r) => {
            const fn = String(r.full_name)
            const key = fn
            const isBusy = busy === key
            return h(
              'div',
              { key, style: S.card },
              h(
                'div',
                { style: S.cardMain },
                h(
                  'div',
                  { style: S.title, onClick: () => void toggleDetail(fn) },
                  h(
                    'a',
                    {
                      href: String(r.url),
                      target: '_blank',
                      rel: 'noreferrer',
                      onClick: (e: { stopPropagation(): void }) => e.stopPropagation(),
                      style: { color: 'inherit' },
                    },
                    fn,
                  ),
                  r.firstParty
                    ? h(
                        'span',
                        {
                          style: {
                            ...S.badge,
                            background: 'rgba(47,111,235,0.16)',
                            color: '#58a6ff',
                          },
                        },
                        t('builtin'),
                      )
                    : null,
                  r.curated ? h('span', { style: S.badge }, t('curated')) : null,
                  r.installed ? h('span', { style: S.badgeGreen }, t('installed')) : null,
                  r.installed && !r.inBundles
                    ? h(
                        'span',
                        {
                          style: {
                            ...S.badge,
                            background: 'rgba(245,158,11,0.18)',
                            color: '#f59e0b',
                          },
                        },
                        t('notActive'),
                      )
                    : null,
                  typeof r.type === 'string' && r.type !== 'unknown'
                    ? h('span', { style: S.badgeGray }, String(r.type))
                    : null,
                ),
                h(
                  'div',
                  { style: S.desc, title: String(r.description) },
                  String(r.description || '—'),
                ),
                h(
                  'div',
                  {
                    style: {
                      display: 'flex',
                      gap: '6px',
                      alignItems: 'center',
                      flexWrap: 'wrap' as const,
                    },
                  },
                  h('span', { style: S.stars }, `★ ${String(r.stars)} ${t('stars')}`),
                  h(
                    'span',
                    { style: S.meta },
                    `${String(r.category ?? '')} · ${String(r.type ?? 'unknown')} · ${String(r.license ?? t('noLicense'))} · ${t('updatedAt')}: ${String(r.updated_at ?? '').slice(0, 10)}`,
                  ),
                ),
                showInfo[fn]
                  ? h(
                      'div',
                      { style: S.detail },
                      h('div', null, `${t('repo')}: ${fn}`),
                      h('div', null, `${t('pkg')}: ${String(r.pkg_name ?? '—')}`),
                      h('div', null, `${t('specLabel')}: ${String(r.installSpec ?? '—')}`),
                      h('div', null, `${t('license')}: ${String(r.license ?? t('noLicense'))}`),
                      h('div', null, `${t('updatedAt')}: ${String(r.updated_at ?? '—')}`),
                      h('div', null, `${t('link')}: ${String(r.url ?? '—')}`),
                    )
                  : null,
                open[fn] ? h('div', { style: S.detail }, open[fn]) : null,
              ),
              h(
                'div',
                {
                  style: {
                    display: 'flex',
                    gap: '6px',
                    flexDirection: 'row',
                    alignItems: 'center',
                    flexWrap: 'wrap' as const,
                  },
                },
                // First-party built-ins are read-only: they ship with the client
                // and are (re)installed by the desktop bootstrap — no install /
                // update / remove / repair actions, only info.
                r.firstParty
                  ? null
                  : r.installed
                    ? h(
                        'button',
                        {
                          style: S.cardBtn,
                          disabled: busy !== null,
                          onClick: () => void openConfirm('update', r),
                        },
                        isBusy ? t('installing') : t('update'),
                      )
                    : h(
                        'button',
                        {
                          style: S.cardBtnPrimary,
                          disabled: busy !== null,
                          onClick: () => void openConfirm('install', r),
                        },
                        isBusy ? t('installing') : t('install'),
                      ),
                !r.firstParty && r.installed && !r.inBundles
                  ? h(
                      'button',
                      {
                        style: {
                          ...S.cardBtnPrimary,
                          background: 'rgba(245,158,11,0.9)',
                          color: '#111',
                        },
                        disabled: busy !== null,
                        onClick: () => void openConfirm('install', r),
                      },
                      t('repair'),
                    )
                  : null,
                !r.firstParty && r.installed
                  ? h(
                      'button',
                      {
                        style: S.cardBtn,
                        disabled: busy !== null,
                        onClick: () => void openConfirm('remove', r),
                      },
                      t('remove'),
                    )
                  : null,
                h(
                  'button',
                  {
                    style: S.cardBtn,
                    disabled: busy !== null,
                    onClick: () => setShowInfo((m) => ({ ...m, [fn]: !m[fn] })),
                  },
                  showInfo[fn] ? t('infoHide') : t('info'),
                ),
              ),
            )
          }),
    repos !== null && sorted.length > 0 && hasMore
      ? h(
          'div',
          { style: { ...S.toolbar, justifyContent: 'center' } },
          h(
            'button',
            { style: S.btn, onClick: () => void load(false, page + 1, true) },
            `${t('loadMore')} (${String(repos.length)}/${String(total)})`,
          ),
        )
      : null,
    output !== ''
      ? h(
          'details',
          { open: true },
          h('summary', { style: S.note }, t('output')),
          h('pre', { style: S.output }, output),
        )
      : null,
    confirm
      ? h(
          'div',
          { style: S.overlay, onClick: () => setConfirm(null) },
          h(
            'div',
            { style: S.modal, onClick: (e: { stopPropagation(): void }) => e.stopPropagation() },
            h('div', { style: S.modalTitle }, t('confirmTitle')),
            h(
              'div',
              { style: S.modalRow },
              h('span', { style: S.modalLabel }, `${t('source')}:`),
              confirm.source,
            ),
            h(
              'div',
              { style: S.modalRow },
              h('span', { style: S.modalLabel }, `${t('profile')}:`),
              profile || '—',
            ),
            h(
              'div',
              { style: S.modalRow },
              h('span', { style: S.modalLabel }, `${t('spec')}:`),
              confirm.spec,
            ),
            h(
              'div',
              { style: S.modalRow },
              h('span', { style: S.modalLabel }, `${t('type')}:`),
              confirm.type,
            ),
            h('div', { style: S.modalTitle }, t('security')),
            confirm.verifying
              ? h('div', { style: S.note }, '…')
              : confirm.verify === null
                ? h('div', { style: S.note }, t('verifyNone'))
                : securityLines(confirm.verify, t).map((line, i) =>
                    h(
                      'div',
                      {
                        key: i,
                        style: line.danger
                          ? S.danger
                          : line.warn
                            ? S.warn
                            : line.ok
                              ? S.okline
                              : S.note,
                      },
                      line.text,
                    ),
                  ),
            h(
              'div',
              { style: S.modalActions },
              h('button', { style: S.btn, onClick: () => setConfirm(null) }, t('cancel')),
              h(
                'button',
                {
                  style: S.btnPrimary,
                  disabled:
                    busy !== null ||
                    confirm.verifying ||
                    String(confirm.verify?.tarballCheck ?? '') === 'mismatch',
                  onClick: () => void doConfirm(),
                },
                confirm.kind === 'install'
                  ? t('confirmInstall')
                  : confirm.kind === 'update'
                    ? t('confirmUpdate')
                    : t('confirmRemove'),
              ),
            ),
          ),
        )
      : null,
  )
}

/**
 * Home-sidebar entry (P-F): a button in the sidebar footer actions that opens
 * the full market as an overlay, so users can install plugins from the home
 * screen without digging into Settings. Reuses <MarketSection> for the panel
 * body (self-contained: fetch + search + install/update/remove), so the same
 * market logic runs in Settings and here. Rendering is native elements + dsw
 * theme tokens only (no ui-primitives dep), keeping the entry safe on hosts
 * without those primitives.
 */
function SidebarMarketEntry(props: { locale: Locale; wide?: boolean }): ReturnType<typeof h> {
  const { locale, wide } = props
  const t = (k: keyof (typeof dict)['zh']): string => dict[locale][k]
  const [open, setOpen] = useState(false)
  return h(
    'div',
    { style: { position: 'relative' } },
    h(
      'button',
      {
        type: 'button',
        'aria-label': t('nav'),
        title: t('nav'),
        onClick: () => setOpen(true),
        style: wide === false ? { ...S.entryBtn, ...S.entryBtnRail } : S.entryBtn,
        onMouseEnter: (e: { currentTarget: HTMLElement }) => {
          e.currentTarget.style.background = 'var(--dsw-alias-hover,#ffffff14)'
        },
        onMouseLeave: (e: { currentTarget: HTMLElement }) => {
          e.currentTarget.style.background = 'transparent'
        },
      },
      h('span', { style: S.entryIcon, 'aria-hidden': true }, '🛒'),
      wide === false ? null : h('span', { style: S.entryLabel }, t('nav')),
    ),
    open
      ? h(
          'div',
          { style: S.overlayFull, onClick: () => setOpen(false) },
          h(
            'div',
            {
              style: S.marketPanel,
              onClick: (e: { stopPropagation(): void }) => e.stopPropagation(),
            },
            h(
              'div',
              { style: S.marketHeader },
              h('span', { style: S.entryIcon, 'aria-hidden': true }, '🛒'),
              h('span', { style: S.marketTitle }, t('nav')),
              h(
                'button',
                {
                  type: 'button',
                  style: S.closeBtn,
                  'aria-label': t('close'),
                  onClick: () => setOpen(false),
                },
                '✕',
              ),
            ),
            h('div', { style: S.marketBody }, h(MarketSection, { locale })),
          ),
        )
      : null,
  )
}

export const name = '@coeasy/dsh-plugin-marketplace'
export const inject = ['slots', 'locale']

export function apply(ctx: MarketClientContext): void {
  const locale = languageOf(ctx)
  ctx.effect(() => {
    if (typeof document !== 'undefined') {
      const el = document.createElement('style')
      el.textContent = '@keyframes coeasy-spin{to{transform:rotate(360deg)}}'
      document.head.appendChild(el)
      return () => el.remove()
    }
    return undefined
  }, 'coeasy-dsh-market: spin')
  ctx.effect(
    () =>
      ctx.locale.register('coeasy-market', { zh: dict.zh, en: dict.en } as unknown as Record<
        string,
        Record<string, string>
      >),
    'coeasy-dsh-market: dictionaries',
  )
  ctx.slots.inject('settings.section', () => {
    ctx.slots.register(
      { name: 'settings.section', id: 'coeasy-market', order: 10, label: () => dict[locale].nav },
      () => h(MarketSection, { locale }),
    )
  })
  // Home entry (P-F): sidebar footer action → overlay market panel, so the
  // market is reachable from the client's home screen, not just Settings.
  ctx.slots.inject('sidebar.footer.action', () => {
    ctx.slots.register(
      {
        name: 'sidebar.footer.action',
        id: 'coeasy-market-entry',
        order: 20,
        label: () => dict[locale].nav,
      },
      (props: Record<string, unknown>) =>
        h(SidebarMarketEntry, { ...(props as { wide?: boolean }), locale }),
    )
  })
}
