/**
 * Shared type surface for the model-config plugin.
 *
 * Pure types only — no runtime code. Mirrors the engine's `ModelSelection`
 * ({ provider, model, reasoningEffort }) and adds stage/Profile concepts that
 * the upstream engine does not own (planning / subagent / evaluation).
 */

/** One of the stages the plugin can route. */
export type Stage = 'default' | 'planning' | 'subagent' | 'evaluation'

/** All stage keys in display order. */
export const STAGES: readonly Stage[] = ['default', 'planning', 'subagent', 'evaluation']

/**
 * A resolved provider/model/effort selection for one stage.
 * `reasoningEffort` and `thinkingBudget` are optional: absence preserves the
 * provider's own default behavior. `thinkingBudget` is reserved for upstream
 * support of per-request thinking budgets (vLLM-style) — the plugin ignores it
 * today but keeps it in the schema for forward compatibility.
 */
export interface ModelBinding {
  provider: string
  model: string
  reasoningEffort?: string
  thinkingBudget?: number
}

/**
 * The stored value for one stage.
 * `follow` points at another stage key to inherit from (the chain terminates
 * at `default`), or `null` when this stage carries its own binding.
 */
export interface StageSetting {
  follow: Stage | null
  binding?: ModelBinding
}

/** Stored stages map: keyed by stage name. */
export type StagesSettings = Partial<Record<Stage, StageSetting>>

/** Named scenario preset: a complete set of stage bindings. */
export interface ModelProfile {
  id: string
  label: string
  description?: string
  stages: Record<Stage, ModelBinding>
}

/**
 * The whole persisted document of this plugin.
 * Lives in its own settings section (`com.my-dsh.model-config`) plus the
 * engine-owned `agentDefaultModel` namespace for the `default` stage.
 */
export interface ModelConfigDocument {
  schemaVersion: number
  stages: StagesSettings
  activeProfile: string | null
  profiles: Record<string, ModelProfile>
}

/** Resolved view: every stage has an effective binding after inheritance. */
export type ResolvedStages = Record<Stage, ModelBinding>

/**
 * Minimal shape of the engine's live model selection that bridges consume.
 * The host adapter maps this to the real `ModelSelectionRef`.
 */
export interface LiveModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

/** Seam the host adapter must implement to switch the live selection at a step boundary. */
export interface ModelSwitchSeam {
  /**
   * Apply a selection to the given agent/session. Resolved by the host to the
   * engine's `installModelSelection` semantics: takes effect on the next step,
   * never splits an in-flight request. Returns a promise resolving when the
   * switch is captured.
   */
  apply(sessionId: string, selection: LiveModelSelection): Promise<void>
  /** Read the current live selection, if any. */
  current?(sessionId: string): LiveModelSelection | undefined
}

/** Seam for the subagent default-injection bridge. */
export interface SubagentResolveSeam {
  /**
   * Resolve the effective binding for a child being created. The host calls
   * this when a child descriptor has no explicit `agentModel`. `role` is the
   * child role (task / reviewer / worker / …) when known.
   */
  resolve(role: string | undefined): ModelBinding | null
}

/** Plan-mode observation seam for the planner bridge. */
export interface PlanModeSeam {
  /** Active while true. When absent, the plugin degrades to "apply on new session". */
  isActive(): boolean
  /** Subscribe to plan-mode activation changes. Returns a disposer. */
  subscribe(onChange: (active: boolean) => void): () => void
}

/** All host seams the model-config plugin accepts (each optional → graceful degradation). */
export interface ModelConfigHost {
  modelSwitch?: ModelSwitchSeam
  subagent?: SubagentResolveSeam
  planMode?: PlanModeSeam
  /** Save to the engine `agentDefaultModel` settings namespace. */
  defaultModelStore?: {
    read(): Promise<ModelBinding | null>
    write(binding: ModelBinding): Promise<void>
  }
}

/** Config passed to the Cordis plugin apply(). */
export interface ModelConfigOptions {
  /** Directory to persist the plugin document; absent = in-memory only. */
  storePath?: string
  /** Storage backend override; takes precedence over storePath. */
  backend?: import('./store.ts').ModelConfigBackend
  /** Version pinned for migration tests; defaults to CURRENT_SCHEMA_VERSION. */
  forceSchemaVersion?: number
  /** Host seams. */
  host?: ModelConfigHost
  /** Engine loopback web server (optional); enables the desktop HTTP API. */
  engine?: { webServer?: import('./engine-http.ts').WebServerLike }
}

/** Validation problem: a machine-readable code plus a human message. */
export interface Problem {
  code: string
  message: string
  path?: string
}

export const CURRENT_SCHEMA_VERSION = 1
