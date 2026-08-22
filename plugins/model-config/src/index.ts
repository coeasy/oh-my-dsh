/**
 * Cordis plugin entry for Model Config.
 *
 * Registers a `modelConfig` service on the context so host bridges can reach
 * the configuration API. Lifecycle contract (from the plan): installing the
 * plugin never rewrites engine settings by itself; it only stores the plugin
 * document. Writes to the engine `agentDefaultModel` namespace happen when the
 * user explicitly calls `applyDefaultToEngine()`, through the host's
 * defaultModelStore seam. Disabling/reset restores engine default behavior.
 *
 * No runtime dependency on the engine or Cordis itself — the context is a thin
 * structural type, so the plugin stays host-agnostic and trivially testable.
 */

import { validateBindingAgainstCatalog, type ModelCatalog } from './catalog.ts'
import { registerModelConfigHttpApi } from './engine-http.ts'
import { PlannerBridge } from './planner-bridge.ts'
import { resolveStage } from './resolver.ts'
import { cloneBinding, defaultDocument, normalizeDocument } from './schema.ts'
import { stageForRole } from './subagent-bridge.ts'
import { ModelConfigStore, fileBackend, memoryBackend, type ModelConfigBackend } from './store.ts'
import type {
  ModelBinding,
  ModelConfigDocument,
  ModelConfigHost,
  ModelConfigOptions,
  ModelProfile,
  Problem,
  ResolvedStages,
  Stage,
} from './types.ts'

export const name = 'model-config'
export const inject = []
export const provide = ['modelConfig']

/** Minimal context surface used by this plugin (host adapters provide it). */
export interface ModelConfigContext {
  on?(event: string, listener: (...args: never[]) => void): void
  emit?(event: string, payload: unknown): void
}

export interface ModelConfigService {
  getDocument(): ModelConfigDocument
  getResolved(input?: { sessionSelection?: ModelBinding | null; role?: string }): ResolvedStages
  getStatus(): {
    ready: boolean
    revision: number
    loadWarnings: unknown[]
    host: {
      modelSwitch: boolean
      subagent: boolean
      planMode: boolean
      defaultModelStore: boolean
    }
    planner: { supported: boolean; hotSwitch: boolean; active: boolean }
  }
  setStage(
    stage: Stage,
    setting: { follow: Stage | null; binding?: ModelBinding },
  ): Promise<{ ok: boolean; problems: Problem[] }>
  setProfile(id: string | null): Promise<{ ok: boolean; problems: Problem[] }>
  saveProfile(profile: ModelProfile): Promise<{ ok: boolean; problems: Problem[] }>
  deleteProfile(id: string): Promise<{ ok: boolean }>
  reset(): Promise<{ ok: boolean }>
  /** Write the default stage binding into the engine defaultModelStore when wired. */
  applyDefaultToEngine(): Promise<{ ok: boolean; reason?: string }>
  validate(binding: ModelBinding, role?: string): Problem[]
  /** Pure resolver helper for the subagent bridge (host calls at child creation). */
  resolveChild(role: string | undefined, explicitModel?: boolean): ModelBinding | null
  /** Read the host-supplied model catalog (for UI selectors). */
  getCatalog(): ModelCatalog | null
  /** Provide/refresh the model catalog from the host. */
  setCatalog(catalog: ModelCatalog | null): void
}

/** Create the modelConfig service. Exposed separately so tests and hosts can
 * obtain the service object directly; the Cordis entry (`apply`) wraps this
 * and registers it on the context. */
export async function createService(
  ctx: ModelConfigContext,
  config: ModelConfigOptions = {},
): Promise<ModelConfigService> {
  const host: ModelConfigHost = config.host ?? {}

  // Backend: host-provided settings backend → local file → in-memory fallback.
  const backend: ModelConfigBackend =
    config.backend ?? (config.storePath ? fileBackend(config.storePath) : memoryBackend())

  const store = await ModelConfigStore.load({
    backend,
    forceSchemaVersion: config.forceSchemaVersion,
  })

  const planner = new PlannerBridge({
    doc: () => store.document,
    modelSwitch: host.modelSwitch,
    planMode: host.planMode,
  })
  planner.start()
  if (ctx.on) ctx.on('dispose', () => planner.dispose())

  const catalogRef: { current: ModelCatalog | null } = { current: null }

  const resolve = (input?: {
    sessionSelection?: ModelBinding | null
    role?: string
  }): ResolvedStages => {
    const out = {} as ResolvedStages
    for (const stage of ['default', 'planning', 'subagent', 'evaluation'] as const) {
      const b = resolveStage(stage, {
        doc: store.document,
        sessionSelection: input?.sessionSelection ?? null,
        role: input?.role,
      })
      if (b) out[stage] = b
    }
    return out
  }

  const service: ModelConfigService = {
    getDocument: () => store.document,
    getResolved: resolve,
    getStatus: () => ({
      ready: true,
      revision: store.currentRevision,
      loadWarnings: store.loadWarnings,
      host: {
        modelSwitch: !!host.modelSwitch,
        subagent: !!host.subagent,
        planMode: !!host.planMode,
        defaultModelStore: !!host.defaultModelStore,
      },
      planner: planner.getStatus(),
    }),
    async setStage(stage, setting) {
      const r = await store.mutate((doc) => {
        if (setting.binding) {
          doc.stages[stage] = { follow: setting.follow, binding: cloneBinding(setting.binding) }
        } else {
          doc.stages[stage] = { follow: setting.follow }
        }
        return doc
      }, backend)
      if (r.ok && ctx.emit) ctx.emit('model-config.stage_changed', { stage, revision: r.revision })
      if (r.ok && !r.persisted && ctx.emit)
        ctx.emit('model-config.persist_failed', { revision: r.revision, stage })
      return { ok: r.ok, problems: r.ok ? [] : problemsFromDoc(store.document) }
    },
    async setProfile(id) {
      const r = await store.mutate((doc) => {
        if (id === null || id in doc.profiles) doc.activeProfile = id
        return doc
      }, backend)
      if (r.ok && ctx.emit) ctx.emit('model-config.profile_changed', { id, revision: r.revision })
      if (r.ok && !r.persisted && ctx.emit)
        ctx.emit('model-config.persist_failed', { revision: r.revision, id })
      return { ok: r.ok, problems: [] }
    },
    async saveProfile(profile) {
      const r = await store.mutate((doc) => {
        doc.profiles[profile.id] = { ...profile, stages: { ...profile.stages } }
        return doc
      }, backend)
      if (r.ok && ctx.emit)
        ctx.emit('model-config.profile_saved', { id: profile.id, revision: r.revision })
      if (r.ok && !r.persisted && ctx.emit)
        ctx.emit('model-config.persist_failed', { revision: r.revision, id: profile.id })
      return { ok: r.ok, problems: r.ok ? [] : problemsFromDoc(store.document) }
    },
    async deleteProfile(id) {
      const r = await store.mutate((doc) => {
        delete doc.profiles[id]
        if (doc.activeProfile === id) doc.activeProfile = null
        return doc
      }, backend)
      return { ok: r.ok }
    },
    async reset() {
      const r = await store.mutate(() => defaultDocument(), backend)
      if (r.ok && ctx.emit) ctx.emit('model-config.reset', { revision: r.revision })
      if (r.ok && !r.persisted && ctx.emit)
        ctx.emit('model-config.persist_failed', { revision: r.revision })
      return { ok: r.ok }
    },
    async applyDefaultToEngine() {
      if (!host.defaultModelStore) return { ok: false, reason: 'host.defaultModelStore not wired' }
      const binding = resolveStage('default', { doc: store.document })
      if (!binding) return { ok: false, reason: 'no default binding to apply' }
      await host.defaultModelStore.write(binding)
      if (ctx.emit) ctx.emit('model-config.engine_default_applied', { binding })
      return { ok: true }
    },
    validate(binding) {
      return validateBindingAgainstCatalog(binding, catalogRef.current)
    },
    resolveChild(role, explicitModel) {
      if (explicitModel) return null
      const stage = stageForRole(role)
      return resolveStage(stage, { doc: store.document })
    },
    getCatalog: () => catalogRef.current,
    setCatalog: (catalog) => {
      catalogRef.current = catalog
    },
  }

  // Engine loopback HTTP API: lets the desktop main process drive the service
  // across the process boundary. Prefer Cordis DI (`ctx.inject(['webServer'])`)
  // — the real engine makes the webServer available via injection, and does not
  // populate config.engine.webServer. The config seam stays as a direct fallback.
  const registerHttp = (webServer: import('./engine-http.ts').WebServerLike): void => {
    registerModelConfigHttpApi(webServer, () => service)
  }
  if (config.engine?.webServer) {
    registerHttp(config.engine.webServer)
  } else if (typeof (ctx as unknown as { inject?: unknown }).inject === 'function') {
    ;(ctx as unknown as {
      inject(
        deps: string[],
        fn: (hostCtx: { get(name: string): unknown }) => void,
      ): void
    }).inject(['webServer'], (hostCtx) => {
      const webServer = hostCtx.get('webServer')
      if (webServer) registerHttp(webServer as import('./engine-http.ts').WebServerLike)
    })
  }

  return service
}

/** Cordis entry: build the service, register it on the context as `modelConfig`,
 * and return void so the engine loader accepts the effect. Host bridges reach
 * the service via `ctx.get('modelConfig')` / `ctx.modelConfig`. */
export async function apply(
  ctx: ModelConfigContext,
  config: ModelConfigOptions = {},
): Promise<void> {
  const service = await createService(ctx, config)
  const c = ctx as unknown as {
    provide?: (name: string, value: ModelConfigService) => void
    modelConfig?: ModelConfigService
  }
  if (typeof c.provide === 'function') c.provide('modelConfig', service)
  else c.modelConfig = service
}

function problemsFromDoc(doc: ModelConfigDocument): Problem[] {
  const { problems } = normalizeDocument(doc)
  return problems
}
