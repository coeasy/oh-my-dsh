/**
 * Persistence for the model-config document.
 *
 * Atomic write + read with a revision counter. The store is intentionally
 * storage-agnostic: the host supplies a `Backend` (engine settings namespace
 * or local file) and the store handles validation, migration, and revision
 * semantics on top. Writes are serialized to avoid interleaving.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { defaultDocument, normalizeDocument } from './schema.ts'
import { migrateDocument } from './migration.ts'
import {
  CURRENT_SCHEMA_VERSION,
  type ModelConfigDocument,
  type ModelConfigOptions,
} from './types.ts'

/** Storage backend abstraction. */
export interface ModelConfigBackend {
  read(): Promise<string | null>
  write(serialized: string): Promise<void>
}

/** Local-file backend (atomic tmp+rename, matching the usage-analytics save pattern). */
export function fileBackend(path: string): ModelConfigBackend {
  return {
    async read() {
      if (!existsSync(path)) return null
      return readFileSync(path, 'utf8')
    },
    async write(serialized: string) {
      mkdirSync(dirname(path), { recursive: true })
      const tmp = `${path}.tmp`
      writeFileSync(tmp, serialized, 'utf8')
      renameSync(tmp, path)
    },
  }
}

/** Engine settings-namespace backend. The host wires the real namespace here. */
export function settingsBackend(
  namespace: string,
  io: {
    read(section: string): Promise<unknown>
    write(section: string, value: unknown): Promise<void>
  },
): ModelConfigBackend {
  return {
    async read() {
      const v = await io.read(namespace)
      if (typeof v === 'string') return v
      return v === null || v === undefined ? null : JSON.stringify(v)
    },
    async write(serialized: string) {
      // Keep JSON documents stored as parsed objects inside the namespace.
      await io.write(namespace, JSON.parse(serialized))
    },
  }
}

/** In-memory backend (default when nothing is wired). */
export function memoryBackend(): ModelConfigBackend {
  let value: string | null = null
  return {
    async read() {
      return value
    },
    async write(serialized: string) {
      value = serialized
    },
  }
}

export interface ModelConfigStoreOptions {
  backend: ModelConfigBackend
  forceSchemaVersion?: number
}

/**
 * Loaded document holder. Owns current doc + revision; all mutations go
 * through `mutate` which re-validates and bumps the revision on change.
 */
export class ModelConfigStore {
  private doc: ModelConfigDocument
  private revision = 0
  private writeChain: Promise<void> = Promise.resolve()
  private loadProblems: unknown[] = []

  constructor(doc: ModelConfigDocument) {
    this.doc = doc
  }

  get document(): ModelConfigDocument {
    return this.doc
  }

  get currentRevision(): number {
    return this.revision
  }

  /** Problems found while loading a previously persisted document (empty = clean load). */
  get loadWarnings(): unknown[] {
    return this.loadProblems
  }

  /** Load from backend: migrate → validate → normalize. Never throws on bad data. */
  static async load(opts: ModelConfigStoreOptions): Promise<ModelConfigStore> {
    const store = new ModelConfigStore(defaultDocument())
    try {
      const serialized = await opts.backend.read()
      if (serialized === null) return store
      let raw: unknown
      try {
        raw = JSON.parse(serialized)
      } catch {
        raw = null
      }
      const migrated = migrateDocument(raw ?? {}) ?? raw
      const { problems, doc } = normalizeDocument(migrated)
      if (doc) {
        store.doc = doc
        store.loadProblems = problems
      } else {
        // Surface-but-survive: a structurally broken document resets to default
        // so the plugin never dead-locks; problems are reported via loadWarnings.
        store.loadProblems = problems
      }
      if (opts.forceSchemaVersion !== undefined) store.doc.schemaVersion = opts.forceSchemaVersion
    } catch {
      // contained: a read failure keeps defaults and is never fatal
    }
    return store
  }

  /** Mutate the document under validation; persists only when valid. */
  async mutate(
    fn: (doc: ModelConfigDocument) => ModelConfigDocument,
    backend: ModelConfigBackend,
  ): Promise<{
    ok: boolean
    revision: number
    doc: ModelConfigDocument
    /** False when the in-memory change succeeded but the persistence write failed. */
    persisted: boolean
  }> {
    const next = fn(structuredClone(this.doc))
    next.schemaVersion = CURRENT_SCHEMA_VERSION
    const { problems, doc } = normalizeDocument(next)
    if (problems.length || !doc) {
      return { ok: false, revision: this.revision, doc: this.doc, persisted: true }
    }
    this.doc = doc
    this.revision += 1
    const serialized = JSON.stringify(this.doc)
    // Serialize writes; a persistence failure must not corrupt in-memory state,
    // but it MUST surface so the caller can tell the user the change is volatile.
    let persisted = true
    this.writeChain = this.writeChain
      .then(() => backend.write(serialized))
      .catch(() => {
        persisted = false
      })
    await this.writeChain
    return { ok: true, revision: this.revision, doc: this.doc, persisted }
  }
}

export type { ModelConfigDocument, ModelConfigOptions }
