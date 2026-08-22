/**
 * Subagent default-injection bridge (plan §6.2).
 *
 * The engine's child descriptor supports an explicit `agentModel`, but has no
 * global default. This bridge resolves the effective binding for a child being
 * created: role override → subagent stage → follow chain. It is a pure,
 * deterministic function so the host can call it at child-creation time
 * regardless of how the engine wires that moment.
 */

import { resolveStage } from './resolver.ts'
import type { ModelBinding, ModelConfigDocument, Stage } from './types.ts'

export interface SubagentResolveInput {
  doc: ModelConfigDocument
  /** Child role (task / reviewer / worker / …) when the host knows it. */
  role?: string | undefined
  /** Whether the child explicitly declared its own model — those are untouched. */
  explicitModel?: boolean
  engineDefault?: ModelBinding | null
}

/**
 * Compute the model binding to inject for a child without an explicit model.
 * Returns null when nothing should be injected (caller leaves the engine
 * default).
 */
export function resolveChildModel(input: SubagentResolveInput): ModelBinding | null {
  if (input.explicitModel) return null
  const stage = stageForRole(input.role)
  const binding = resolveStage(stage, {
    doc: input.doc,
    engineDefault: input.engineDefault ?? null,
    role: input.role,
  })
  return binding
}

/** Stable role→stage hint table (not authoritative; hosts may extend). */
export const ROLE_STAGE_HINT: Readonly<Record<string, Stage>> = {
  task: 'subagent',
  reviewer: 'subagent',
  worker: 'subagent',
  evaluator: 'evaluation',
}

/** Effective stage to consult for a given child role. */
export function stageForRole(role: string | undefined): Stage {
  if (!role) return 'subagent'
  return ROLE_STAGE_HINT[role] ?? 'subagent'
}
