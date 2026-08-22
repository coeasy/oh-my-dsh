/**
 * Planner bridge — the plan §6.2 bridge for "planning stage uses its own
 * model". The engine has no separate planning-model field; the plugin switches
 * the live `ModelSelectionRef` at step boundaries when plan mode activates.
 *
 * Degradation ladder when host seams are absent:
 *   - planMode seam present + modelSwitch present → live hot-switch on toggle
 *   - only modelSwitch present → best-effort "apply to next step of this session"
 *   - neither → no-op; the bridge reports `supported: false` so the UI can show
 *     "planning model requires host support".
 */

import { resolveStage } from './resolver.ts'
import type { ModelConfigDocument, ModelSwitchSeam, PlanModeSeam } from './types.ts'

export interface PlannerBridgeOptions {
  doc: () => ModelConfigDocument
  modelSwitch?: ModelSwitchSeam
  planMode?: PlanModeSeam
  engineDefault?: () => ReturnType<typeof resolveStage> | null
}

export interface PlannerBridgeStatus {
  supported: boolean
  hotSwitch: boolean
  active: boolean
}

export class PlannerBridge {
  private opts: PlannerBridgeOptions
  private active = false
  private disposed = false
  private disposer: (() => void) | null = null

  constructor(opts: PlannerBridgeOptions) {
    this.opts = opts
  }

  /** Bind to the plan-mode seam. Call once at plugin start. */
  start(): void {
    const pm = this.opts.planMode
    if (!pm) return
    this.active = pm.isActive()
    this.disposer = pm.subscribe((active) => {
      this.active = active
      this.apply(undefined).catch(() => {})
    })
  }

  /**
   * Apply the planning binding to a session. When `sessionId` is omitted and
   * only the plan-mode seam is live, applies to the active session reported by
   * the seam (hosts may enrich this later).
   */
  async apply(sessionId: string | undefined): Promise<boolean> {
    if (!this.active) return false
    const ms = this.opts.modelSwitch
    if (!ms) return false
    const doc = this.opts.doc()
    const binding = resolveStage('planning', {
      doc,
      engineDefault: this.opts.engineDefault ? this.opts.engineDefault() : undefined,
    })
    if (!binding || !sessionId) return false
    await ms.apply(sessionId, {
      provider: binding.provider,
      model: binding.model,
      ...(binding.reasoningEffort ? { reasoningEffort: binding.reasoningEffort } : {}),
    })
    return true
  }

  getStatus(): PlannerBridgeStatus {
    const pm = !!this.opts.planMode
    const ms = !!this.opts.modelSwitch
    return {
      supported: pm || ms,
      hotSwitch: pm && ms,
      active: this.active,
    }
  }

  /** Release the plan-mode subscription. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.disposer?.()
    this.disposer = null
  }
}
