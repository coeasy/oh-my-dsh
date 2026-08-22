/**
 * Document version migration.
 *
 * `migrateDocument` upgrades an older persisted document to the current schema
 * version step by step. It is idempotent and never mutates the input. New
 * fields introduced by a version upgrade are filled from a supplied default;
 * unknown fields from the future are rejected upstream (schema.ts).
 */

import { CURRENT_SCHEMA_VERSION, type ModelConfigDocument } from './types.ts'

/** Move 0.x documents (pre-release) to v1. Kept for symmetry with the plan's
 * migration seam; no real step exists yet. */
function migrate_v0_to_v1(raw: Record<string, unknown>): ModelConfigDocument {
  // v0 had the same shape as v1; only the schemaVersion marker differs.
  return {
    schemaVersion: 1,
    stages: (raw.stages as ModelConfigDocument['stages']) ?? {},
    activeProfile: (raw.activeProfile as string | null) ?? null,
    profiles: (raw.profiles as ModelConfigDocument['profiles']) ?? {},
  }
}

/** Registered migrations, indexed by FROM version. */
const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => ModelConfigDocument> = {
  0: migrate_v0_to_v1,
}

/**
 * Upgrade a raw persisted document to the current version.
 * Returns the upgraded document (schemaVersion = CURRENT) or null when the
 * source is already at/above current.
 */
export function migrateDocument(raw: unknown): ModelConfigDocument | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const version = typeof r.schemaVersion === 'number' ? r.schemaVersion : 0
  if (version >= CURRENT_SCHEMA_VERSION) return null
  const step = MIGRATIONS[version]
  if (!step) return null
  let doc = step(r)
  // Chain any further steps (future-proofing for multi-step migrations).
  while (doc.schemaVersion < CURRENT_SCHEMA_VERSION) {
    const next = MIGRATIONS[doc.schemaVersion]
    if (!next) break
    doc = next(doc as unknown as Record<string, unknown>)
  }
  return doc
}
