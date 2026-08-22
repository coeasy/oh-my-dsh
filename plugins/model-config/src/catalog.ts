/**
 * Provider/model catalog validation (plan §9 — save-time checks).
 *
 * The plugin does not own the catalog; the host provides it (the engine's
 * provider routes + adapter-published efforts). These helpers are pure and
 * testable, and fall back to "unknown catalog → pass-through with a warning"
 * so the plugin stays usable before the host wires a real catalog.
 */

import type { ModelBinding, Problem } from './types.ts'

/** One adapter-published reasoning-effort option. */
export interface EffortInfo {
  id: string
  label?: string
  description?: string
}

/** Provider route entry from the host catalog. */
export interface CatalogProvider {
  id: string
  /** Provider-owned model ids served by this route. */
  models: readonly string[]
  /** Efforts per exact model id, when published. */
  efforts?: Readonly<Record<string, readonly EffortInfo[]>>
}

/** Host-supplied catalog (optional). */
export interface ModelCatalog {
  providers: readonly CatalogProvider[]
  /** Versioned cache stamp; unused today, reserved for consistency checks. */
  stamp?: string
}

/** Unknown catalog mode: checks pass through (nothing to validate against). */
export const UNKNOWN_CATALOG: ModelCatalog | null = null

/**
 * Validate a binding against a catalog. Returns problems; empty = valid.
 * With a null catalog every binding is accepted (unverified) — callers should
 * surface this as a warning, not a failure.
 */
export function validateBindingAgainstCatalog(
  binding: ModelBinding,
  catalog: ModelCatalog | null,
): Problem[] {
  if (!catalog) return []
  const problems: Problem[] = []
  const provider = catalog.providers.find((p) => p.id === binding.provider)
  if (!provider) {
    problems.push({
      code: 'catalog.provider_unknown',
      message: `provider '${binding.provider}' is not in the catalog`,
      path: 'provider',
    })
    return problems
  }
  if (!provider.models.includes(binding.model)) {
    problems.push({
      code: 'catalog.model_unknown',
      message: `model '${binding.model}' is not served by provider '${binding.provider}'`,
      path: 'model',
    })
  }
  if (binding.reasoningEffort) {
    const efforts = provider.efforts?.[binding.model]
    if (efforts && !efforts.some((e) => e.id === binding.reasoningEffort)) {
      problems.push({
        code: 'catalog.effort_unknown',
        message: `reasoningEffort '${binding.reasoningEffort}' is not offered by ${binding.provider}/${binding.model}`,
        path: 'reasoningEffort',
      })
    }
  }
  return problems
}

/** Known-effort check used by the UI to filter options: valid effort ids for a model. */
export function effortsFor(
  catalog: ModelCatalog | null,
  provider: string,
  model: string,
): readonly EffortInfo[] {
  if (!catalog) return []
  const p = catalog.providers.find((x) => x.id === provider)
  return p?.efforts?.[model] ?? []
}
