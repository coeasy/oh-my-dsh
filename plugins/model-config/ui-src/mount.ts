/**
 * Model Config settings UI bundle (platform-agnostic).
 *
 * Mounts into `#model-config-root` and talks to the host through the
 * `window.__MODEL_CONFIG_HOST_BRIDGE__` contract. The desktop host page wires
 * this bridge to the plugin service (via IPC / engine loopback); the bundle
 * itself stays pure rendering + calls.
 *
 * The bridge contract:
 *   getStatus(): { ready, revision, host: {...}, planner: {...} }
 *   getDocument(): ModelConfigDocument
 *   getCatalog(): { providers: CatalogProvider[] } | null
 *   setStage(stage, setting): { ok, problems }
 *   setProfile(id|null): { ok }
 *   reset(): { ok }
 *   applyDefaultToEngine(): { ok, reason? }
 */

const STAGES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'default', label: '默认模型' },
  { id: 'planning', label: '独立规划模型' },
  { id: 'subagent', label: '子代理模型' },
  { id: 'evaluation', label: '评估模型' },
]

interface Bridge {
  getStatus(): Promise<any>
  getDocument(): Promise<any>
  getCatalog(): Promise<any>
  setStage(stage: string, setting: any): Promise<any>
  setProfile(id: string | null): Promise<any>
  reset(): Promise<any>
  applyDefaultToEngine(): Promise<any>
}

interface Catalog {
  providers: Array<{
    id: string
    models: string[]
    efforts?: Record<string, Array<{ id: string; label?: string }>>
  }>
}

function bridge(): Bridge {
  const b = (window as any).__MODEL_CONFIG_HOST_BRIDGE__
  if (!b) throw new Error('__MODEL_CONFIG_HOST_BRIDGE__ not available')
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

function sel(
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLSelectElement {
  return el('select', attrs, children) as HTMLSelectElement
}

function inp(attrs: Record<string, string> = {}): HTMLInputElement {
  return el('input', attrs) as HTMLInputElement
}

export function mount(root: HTMLElement): void {
  root.innerHTML = ''
  const statusWrap = el('div', { class: 'mc-status' })
  const body = el('div', { class: 'mc-body' })
  root.append(statusWrap, body)

  const render = async (): Promise<void> => {
    let status: any
    let doc: any
    let catalog: Catalog | null = null
    try {
      const b = bridge()
      ;[status, doc] = await Promise.all([b.getStatus(), b.getDocument()])
      try {
        catalog = await b.getCatalog()
      } catch {
        catalog = null
      }
    } catch (err) {
      statusWrap.innerHTML = ''
      statusWrap.append(
        el('div', { class: 'mc-error' }, [
          `无法连接宿主桥接：${(err as Error).message}`,
          '（桌面端需在插件宿主页面内加载，或宿主尚未接线 model-config 服务）',
        ]),
      )
      return
    }

    statusWrap.innerHTML = ''
    statusWrap.append(
      el('div', { class: 'mc-hint' }, [
        `生效范围：配置影响新会话与新派发的子代理；已有会话沿用各自保存的选择。`,
        ` host: ${status.host.modelSwitch ? 'modelSwitch✓' : 'modelSwitch✗'} · ` +
          `${status.host.planMode ? 'planMode✓' : 'planMode✗'} · ` +
          `${status.host.subagent ? 'subagent✓' : 'subagent✗'} · ` +
          `revision ${status.revision}`,
      ]),
    )

    body.innerHTML = ''
    // Section: stage bindings.
    body.append(el('h3', {}, ['使用模型']))
    for (const stage of STAGES) {
      const setting = (doc.stages ?? {})[stage.id] ?? {
        follow: stage.id === 'default' ? null : 'default',
      }
      const isDefault = stage.id === 'default'
      const binding = setting.binding
      const row = el('div', { class: 'mc-row' })
      const label = el('label', { class: 'mc-label' }, [stage.label])
      row.append(label)

      const controls = el('div', { class: 'mc-controls' })
      if (isDefault) {
        const [prov, model, effort, budget] = modelSelectors(catalog, binding)
        controls.append(prov, model, effort, budget)
      } else {
        const followSel = sel({})
        followSel.append(
          el('option', { value: 'follow' }, ['使用当前模型（跟随默认）']),
          el('option', { value: 'independent' }, ['独立选择模型…']),
        )
        followSel.value = binding ? 'independent' : 'follow'
        followSel.addEventListener('change', () => {
          const follow = followSel.value === 'follow'
          void bridge().setStage(stage.id, follow ? { follow: 'default' } : { follow: null })
          void render()
        })
        controls.append(followSel)
        if (binding) {
          const [prov, model, effort, budget] = modelSelectors(catalog, binding, stage.id)
          controls.append(prov, model, effort, budget)
        }
      }
      row.append(controls)
      body.append(row)
    }

    // Profile section.
    body.append(el('h3', {}, ['场景预设']))
    const profileRow = el('div', { class: 'mc-row' })
    const profileLabel = el('label', { class: 'mc-label' }, ['启用预设'])
    const profileSel = sel({})
    profileSel.append(el('option', { value: '' }, ['无']))
    for (const [pid, p] of Object.entries((doc.profiles ?? {}) as Record<string, any>)) {
      profileSel.append(el('option', { value: pid }, [`${p.label} (${pid})`]))
    }
    profileSel.value = doc.activeProfile ?? ''
    profileSel.addEventListener('change', () => {
      void bridge()
        .setProfile(profileSel.value || null)
        .then(() => render())
    })
    profileRow.append(profileLabel, profileSel)
    body.append(profileRow)

    // Actions.
    const actions = el('div', { class: 'mc-actions' }, [])
    const applyBtn = el('button', { class: 'mc-btn' }, ['应用默认模型到引擎'])
    applyBtn.addEventListener('click', () => {
      void bridge()
        .applyDefaultToEngine()
        .then((r) => {
          statusWrap.append(
            el('div', { class: 'mc-msg' }, [r.ok ? '已应用' : `未应用：${r.reason ?? '未知'}`]),
          )
        })
    })
    const resetBtn = el('button', { class: 'mc-btn mc-btn-danger' }, ['重置配置'])
    resetBtn.addEventListener('click', () => {
      if (confirm('重置所有模型配置？')) {
        void bridge()
          .reset()
          .then(() => render())
      }
    })
    actions.append(applyBtn, resetBtn)
    body.append(actions)
  }

  void render()
}

/** Build provider/model/effort selectors bound to a stage binding. */
function modelSelectors(catalog: Catalog | null, binding: any, stageId?: string): HTMLElement[] {
  const providers = catalog?.providers ?? []
  const provSel = sel({ class: 'mc-provider' })
  provSel.append(el('option', { value: '' }, ['选择 provider…']))
  for (const p of providers) provSel.append(el('option', { value: p.id }, [p.id]))
  if (binding) provSel.value = binding.provider

  const modelSel = sel({ class: 'mc-model' })
  modelSel.append(el('option', { value: '' }, ['选择 model…']))
  const currentProvider = providers.find((p) => p.id === (binding?.provider ?? provSel.value))
  for (const m of currentProvider?.models ?? []) modelSel.append(el('option', { value: m }, [m]))
  if (binding) modelSel.value = binding.model

  const effortSel = sel({ class: 'mc-effort' })
  effortSel.append(el('option', { value: '' }, ['思考档位：默认（服务方决定）']))
  const efforts = currentProvider?.efforts?.[modelSel.value] ?? []
  for (const e of efforts) effortSel.append(el('option', { value: e.id }, [e.label ?? e.id]))
  if (binding?.reasoningEffort) effortSel.value = binding.reasoningEffort

  const budget = inp({
    class: 'mc-budget',
    type: 'number',
    min: '0',
    placeholder: 'thinkingBudget',
  })
  if (binding?.thinkingBudget !== undefined) budget.value = String(binding.thinkingBudget)

  const commit = (): void => {
    if (!provSel.value || !modelSel.value) return
    const setting: any = {
      follow: null,
      binding: {
        provider: provSel.value,
        model: modelSel.value,
        ...(effortSel.value ? { reasoningEffort: effortSel.value } : {}),
      },
    }
    const budgetVal = Number(budget.value)
    if (Number.isFinite(budgetVal) && budgetVal >= 0 && budget.value !== '') {
      setting.binding.thinkingBudget = budgetVal
    }
    void bridge().setStage(stageId ?? 'default', setting)
  }
  provSel.addEventListener('change', () => {
    modelSel.innerHTML = ''
    modelSel.append(el('option', { value: '' }, ['选择 model…']))
    const p = providers.find((x) => x.id === provSel.value)
    for (const m of p?.models ?? []) modelSel.append(el('option', { value: m }, [m]))
    effortSel.innerHTML = ''
    effortSel.append(el('option', { value: '' }, ['思考档位：默认（服务方决定）']))
    commit()
  })
  modelSel.addEventListener('change', () => {
    effortSel.innerHTML = ''
    effortSel.append(el('option', { value: '' }, ['思考档位：默认（服务方决定）']))
    const p = providers.find((x) => x.id === provSel.value)
    for (const e of p?.efforts?.[modelSel.value] ?? []) {
      effortSel.append(el('option', { value: e.id }, [e.label ?? e.id]))
    }
    commit()
  })
  effortSel.addEventListener('change', () => commit())
  budget.addEventListener('change', () => commit())

  return [provSel, modelSel, effortSel, budget]
}

// Register the mount function so the desktop host page can call it after
// wiring __MODEL_CONFIG_HOST_BRIDGE__.
;(window as any).__MODEL_CONFIG_MOUNT__ = mount

export function autoMount(): void {
  const root = document.getElementById('model-config-root')
  if (root) mount(root)
}
