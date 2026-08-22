/**
 * Stage binding resolution — the priority chain from the plan §4.1.
 *
 * 1. Session-level live override (not persisted; supplied by the host)
 * 2. Active Profile stage binding
 * 3. Stage's own binding
 * 4. `follow` chain (terminating at `default`)
 * 5. Engine `agentDefaultModel` (supplied by the host store)
 * 6. Provider default behavior (represented by `null` — no binding to apply)
 *
 * The resolver is a pure function of a document plus runtime inputs; it has no
 * I/O and no engine coupling, so it is trivially testable.
 */

import {
  STAGES,
  type ModelBinding,
  type ModelConfigDocument,
  type ResolvedStages,
  type Stage,
  type StageSetting,
} from './types.ts'

export interface ResolveInput {
  doc: ModelConfigDocument
  /** Session-level live selection (override). Optional. */
  sessionSelection?: ModelBinding | null
  /** Effective engine default model (agentDefaultModel). Optional. */
  engineDefault?: ModelBinding | null
  /** Child role when resolving the subagent stage; ignored elsewhere. */
  role?: string | undefined
}

/** Resolve one stage's effective binding, following the chain. */
export function resolveStage(stage: Stage, input: ResolveInput): ModelBinding | null {
  // 1. Session-level override wins outright.
  if (input.sessionSelection) return input.sessionSelection

  // 2. Active profile.
  const profile = input.doc.activeProfile ? input.doc.profiles[input.doc.activeProfile] : undefined
  if (profile && profile.stages[stage]) return profile.stages[stage]

  // 3 + 4. Stage own binding then follow chain.
  const chain: Stage[] = []
  let cur: Stage | null = stage
  while (cur !== null && !chain.includes(cur)) {
    chain.push(cur)
    const setting: StageSetting | undefined = input.doc.stages[cur]
    if (setting?.binding) return setting.binding
    cur = setting?.follow ?? null
  }
  // Cycle is rejected at validation time; guard anyway.

  // 5. Engine default for the default stage (or any chain that bottomed out).
  if (input.engineDefault) return input.engineDefault

  // 6. Provider default — caller should not override the request.
  return null
}

/** Resolve every stage into a flat map. */
export function resolveStages(input: ResolveInput): ResolvedStages {
  const out = {} as ResolvedStages
  for (const stage of STAGES) {
    const b = resolveStage(stage, input)
    if (b) out[stage] = b
  }
  return out
}
