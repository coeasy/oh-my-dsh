/**
 * Degeneration Guard settings/status UI bundle (platform-agnostic).
 *
 * Mounts into `#guard-root` and talks to the host through
 * `window.__GUARD_HOST_BRIDGE__`:
 *   getStatus(): GuardStatus
 *   setMode(mode): void
 *   resume(): void
 *   getConfig(): GuardConfig
 */

interface Bridge {
  getStatus(): Promise<any>
  setMode(mode: string): Promise<void>
  resume(): Promise<void>
  getConfig(): Promise<any>
}

/** P0-5: per-mode preset descriptions surfaced in the picker cards. */
const MODE_CARDS: Array<{ id: string; name: string; desc: string; accent: string }> = [
  {
    id: 'standard',
    name: '标准',
    desc: '平衡误报与检出，适合日常',
    accent: '#2f6feb',
  },
  {
    id: 'strict',
    name: '严格',
    desc: '更短阈值、更早拦截、更易误报',
    accent: '#d29922',
  },
  {
    id: 'off',
    name: '关闭',
    desc: '完全停止检测',
    accent: '#6e7681',
  },
]

function modeCardStyle(active: boolean, accent: string): Partial<CSSStyleDeclaration> {
  return {
    flex: '1',
    padding: '10px 12px',
    borderRadius: '8px',
    cursor: 'pointer',
    border: active ? `2px solid ${accent}` : '1px solid #30363d',
    background: active ? 'rgba(47,111,235,0.08)' : '#0d1117',
    textAlign: 'left',
    color: active ? '#e6edf3' : '#8b949e',
    fontFamily: 'inherit',
    fontSize: '12px',
  }
}

function bridge(): Bridge {
  const b = (window as any).__GUARD_HOST_BRIDGE__
  if (!b) throw new Error('__GUARD_HOST_BRIDGE__ not available')
  return b
}

function el(
  tag: string,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElement {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
  for (const c of children) node.append(c as Node)
  return node
}

export function mount(root: HTMLElement): void {
  root.innerHTML = ''
  const statusWrap = el('div', { class: 'g-status' })
  const body = el('div', { class: 'g-body' })
  root.append(statusWrap, body)

  const render = async (): Promise<void> => {
    let status: any
    let cfg: any
    try {
      const b = bridge()
      ;[status, cfg] = await Promise.all([b.getStatus(), b.getConfig()])
    } catch (err) {
      statusWrap.innerHTML = ''
      statusWrap.append(
        el('div', { class: 'g-error' }, [
          `无法连接宿主桥接：${(err as Error).message}`,
          '（需在插件宿主页面内加载，或宿主尚未接线 degeneration-guard 服务）',
        ]),
      )
      return
    }

    statusWrap.innerHTML = ''
    if (status.active.paused) {
      const bar = el('div', { class: 'g-pause' }, [`⚠ 已暂停：${status.active.pauseReason ?? ''}`])
      const resumeBtn = el('button', { class: 'g-btn' }, ['继续（用户决策）'])
      resumeBtn.addEventListener('click', async () => {
        await bridge().resume()
        render()
      })
      bar.append(resumeBtn)
      statusWrap.append(bar)
    } else {
      statusWrap.append(
        el('div', { class: 'g-ok' }, [
          `模式：${status.mode} · 检测 ${status.stats.thinkingChecks} · 命中 ${status.stats.thinkingHits} · 重试 ${status.stats.retries} · 暂停 ${status.stats.pauses} · 工具提醒 ${status.stats.toolRepeatWarns} · 轮次提醒 ${status.stats.turnReminders}`,
          ` host: ${status.host.interrupt ? 'interrupt✓' : 'interrupt✗'}`,
        ]),
      )
    }

    body.innerHTML = ''
    // P0-5: mode selector as three described cards (not a bare <select>).
    const modeHeading = el('div', { class: 'g-label' }, ['运行档位'])
    body.append(modeHeading)
    const modeCards = el(
      'div',
      { style: 'display:flex; gap:8px; margin:2px 0 8px;' },
      MODE_CARDS.map((m) => {
        const active = status.mode === m.id
        const card = el(
          'button',
          {
            style: Object.entries(modeCardStyle(active, m.accent))
              .map(([k, v]) => `${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:${v}`)
              .join(';'),
            title: m.desc,
          },
          [
            el('div', { style: 'font-weight:600; font-size:13px;' }, [m.name]),
            el('div', { style: 'margin-top:3px; opacity:0.85; line-height:1.4;' }, [m.desc]),
          ],
        )
        card.addEventListener('click', async () => {
          if (active) return
          await bridge().setMode(m.id)
          render()
        })
        return card
      }),
    )
    body.append(modeCards)

    // Restore to the balanced default preset (== the standard preset).
    const restoreBtn = el('button', { class: 'g-btn' }, ['恢复默认（标准预设）'])
    restoreBtn.style.background = '#21262d'
    restoreBtn.style.color = '#e6edf3'
    restoreBtn.style.border = '1px solid #30363d'
    restoreBtn.addEventListener('click', async () => {
      await bridge().setMode('standard')
      render()
    })
    const restoreRow = el('div', { class: 'g-row' }, [restoreBtn])
    body.append(restoreRow)

    // Detection parameters (read-only display).
    body.append(el('h3', {}, ['检测参数']))
    const params: Array<[string, string]> = [
      ['思考档位模式', cfg.mode],
      ['自动重试一次', String(cfg.autoRetry)],
      ['重复模式长度下限', String(cfg.stream.minPatternSize)],
      ['重复模式长度上限', String(cfg.stream.maxPatternSize)],
      ['连续重复次数', String(cfg.stream.minCount)],
      ['滚动窗口', String(cfg.stream.windowChars)],
      ['思考段长度上限', String(cfg.stream.maxThinkingChars)],
      ['响应长度上限', String(cfg.stream.maxResponseChars)],
      ['工具硬停止阈值', String(cfg.tool.hardStop)],
      ['会话轮次上限（提醒）', String(cfg.maxTurnsPerSession)],
    ]
    const table = el('table', { class: 'g-table' })
    for (const [k, v] of params) {
      const tr = el('tr', {}, [])
      tr.append(el('td', {}, [k]), el('td', {}, [v]))
      table.append(tr)
    }
    body.append(table)
  }

  void render()
}

// Register the mount function so the desktop host page can call it after
// wiring __GUARD_HOST_BRIDGE__.
;(window as any).__GUARD_MOUNT__ = mount

export function autoMount(): void {
  const root = document.getElementById('guard-root')
  if (root) mount(root)
}
