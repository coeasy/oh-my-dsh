/**
 * Schema validation for the model-config document.
 *
 * Zero-dependency, strict validation: every persisted document passes through
 * `normalizeDocument` before it is trusted. Invalid fields fail loud with a
 * problem list — never silently coerced to defaults (mirrors the engine's
 * "misconfiguration fails loud" convention).
 */

import {
  CURRENT_SCHEMA_VERSION,
  STAGES,
  type ModelConfigDocument,
  type ModelBinding,
  type ModelProfile,
  type Problem,
  type Stage,
  type StageSetting,
} from './types.ts'

const STAGE_SET: ReadonlySet<string> = new Set(STAGES)
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** Default document: every stage follows `default`, no active profile. */
export function defaultDocument(): ModelConfigDocument {
  const stages: ModelConfigDocument['stages'] = {}
  for (const stage of STAGES) {
    stages[stage] = stage === 'default' ? { follow: null } : { follow: 'default' }
  }
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    stages,
    activeProfile: null,
    profiles: {},
  }
}

/** Validate a single binding. `binding` must not carry unknown keys that could slip through. */
export function validateBinding(
  value: unknown,
  path: string,
  problems: Problem[],
): ModelBinding | null {
  if (typeof value !== 'object' || value === null) {
    problems.push({ code: 'binding.not_object', message: `${path} must be an object`, path })
    return null
  }
  const b = value as Record<string, unknown>
  if (typeof b.provider !== 'string' || b.provider.length === 0) {
    problems.push({
      code: 'binding.provider_required',
      message: `${path}.provider is required`,
      path,
    })
    return null
  }
  if (typeof b.model !== 'string' || b.model.length === 0) {
    problems.push({ code: 'binding.model_required', message: `${path}.model is required`, path })
    return null
  }
  const out: ModelBinding = { provider: b.provider, model: b.model }
  if (b.reasoningEffort !== undefined) {
    if (typeof b.reasoningEffort !== 'string' || b.reasoningEffort.length === 0) {
      problems.push({
        code: 'binding.effort_invalid',
        message: `${path}.reasoningEffort must be a string`,
        path,
      })
    } else {
      out.reasoningEffort = b.reasoningEffort
    }
  }
  if (b.thinkingBudget !== undefined) {
    if (
      typeof b.thinkingBudget !== 'number' ||
      !Number.isInteger(b.thinkingBudget) ||
      b.thinkingBudget < 0
    ) {
      problems.push({
        code: 'binding.budget_invalid',
        message: `${path}.thinkingBudget must be a non-negative integer`,
        path,
      })
    } else {
      out.thinkingBudget = b.thinkingBudget
    }
  }
  return out
}

/** Validate one stage setting. */
function validateStage(value: unknown, path: string, problems: Problem[]): StageSetting | null {
  if (typeof value !== 'object' || value === null) {
    problems.push({ code: 'stage.not_object', message: `${path} must be an object`, path })
    return null
  }
  const s = value as Record<string, unknown>
  if (s.follow !== null && (typeof s.follow !== 'string' || !STAGE_SET.has(s.follow))) {
    problems.push({
      code: 'stage.follow_invalid',
      message: `${path}.follow must be a stage name or null`,
      path,
    })
    return null
  }
  const out: StageSetting = { follow: s.follow === null ? null : (s.follow as Stage) }
  if (s.binding !== undefined) {
    const binding = validateBinding(s.binding, `${path}.binding`, problems)
    if (binding) out.binding = binding
  } else if (out.follow === null && s.follow === null) {
    // A stage that neither follows nor carries a binding is allowed only as an
    // explicit "unset" marker; resolver falls back to engine default.
  }
  return out
}

/**
 * Validate and normalize an untrusted document. Returns problems (empty =
 * valid) and the normalized document (best-effort, only valid parts kept).
 * A document with structural errors is NOT applied by the store.
 */
export function normalizeDocument(raw: unknown): {
  problems: Problem[]
  doc: ModelConfigDocument | null
} {
  const problems: Problem[] = []
  if (typeof raw !== 'object' || raw === null) {
    return {
      problems: [{ code: 'doc.not_object', message: 'document must be an object' }],
      doc: null,
    }
  }
  const r = raw as Record<string, unknown>
  if (typeof r.schemaVersion !== 'number') {
    problems.push({ code: 'doc.schema_version_missing', message: 'schemaVersion is required' })
    return { problems, doc: null }
  }
  if (r.schemaVersion > CURRENT_SCHEMA_VERSION) {
    problems.push({
      code: 'doc.schema_version_future',
      message: `schemaVersion ${r.schemaVersion} is newer than supported ${CURRENT_SCHEMA_VERSION}`,
    })
    return { problems, doc: null }
  }
  // Version migration is handled by migration.ts before normalization.
  const stagesRaw = (r.stages ?? {}) as Record<string, unknown>
  const stages: ModelConfigDocument['stages'] = {}
  for (const stage of STAGES) {
    if (stagesRaw[stage] !== undefined) {
      const s = validateStage(stagesRaw[stage], `stages.${stage}`, problems)
      if (s) stages[stage] = s
    } else {
      stages[stage] = stage === 'default' ? { follow: null } : { follow: 'default' }
    }
  }
  // Every stage must resolve without a cycle: validate follow graph now.
  validateFollowGraph(stages, problems)

  let activeProfile: string | null = null
  if (r.activeProfile !== null && r.activeProfile !== undefined) {
    if (typeof r.activeProfile !== 'string') {
      problems.push({
        code: 'doc.active_profile_invalid',
        message: 'activeProfile must be a string or null',
      })
    } else {
      activeProfile = r.activeProfile
    }
  }

  const profiles: Record<string, ModelProfile> = {}

  const profilesRaw = (r.profiles ?? {}) as Record<string, any>
  for (const [pid, pv] of Object.entries(profilesRaw)) {
    if (!ID_RE.test(pid)) {
      problems.push({
        code: 'profile.id_invalid',
        message: `profile id must match ${ID_RE}`,
        path: `profiles.${pid}`,
      })
      continue
    }
    if (typeof pv !== 'object' || pv === null) {
      problems.push({
        code: 'profile.not_object',
        message: `profile ${pid} must be an object`,
        path: `profiles.${pid}`,
      })
      continue
    }
    const profile: Record<string, unknown> = pv as Record<string, unknown>
    const label = typeof profile.label === 'string' && profile.label.length ? profile.label : pid
    const description = typeof profile.description === 'string' ? profile.description : undefined
    const stagesMap: Record<Stage, ModelBinding> = {} as Record<Stage, ModelBinding>
    let profileOk = true
    for (const stage of STAGES) {
      const profileStages = (profile.stages ?? {}) as Record<string, unknown>
      const b = validateBinding(profileStages[stage], `profiles.${pid}.stages.${stage}`, problems)
      if (!b) {
        profileOk = false
        break
      }
      stagesMap[stage] = b
    }
    if (!profileOk) continue
    profiles[pid] = { id: pid, label, description, stages: stagesMap }
  }

  // activeProfile must exist when non-null.
  if (activeProfile !== null && !(activeProfile in profiles)) {
    problems.push({
      code: 'doc.active_profile_missing',
      message: `activeProfile ${activeProfile} not found`,
    })
    activeProfile = null
  }

  const doc: ModelConfigDocument = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    stages,
    activeProfile,
    profiles,
  }
  return { problems, doc }
}

/** Detect follow cycles (a → b → a) that would break resolution. */
function validateFollowGraph(stages: ModelConfigDocument['stages'], problems: Problem[]): void {
  for (const stage of STAGES) {
    const seen = new Set<Stage>()
    let cur: Stage | undefined = stage
    while (cur !== undefined) {
      if (seen.has(cur)) {
        problems.push({
          code: 'stage.follow_cycle',
          message: `follow cycle detected at stage ${stage}`,
          path: `stages.${stage}`,
        })
        return
      }
      seen.add(cur)
      const setting: StageSetting | undefined = stages[cur]
      cur = setting?.follow ?? undefined
    }
  }
}

/** Deep-clone a binding (detached, safe to mutate). */
export function cloneBinding(b: ModelBinding): ModelBinding {
  const out: ModelBinding = { provider: b.provider, model: b.model }
  if (b.reasoningEffort) out.reasoningEffort = b.reasoningEffort
  if (b.thinkingBudget !== undefined) out.thinkingBudget = b.thinkingBudget
  return out
}
