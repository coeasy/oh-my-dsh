import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  ADAPTERS,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MAX_PER_SOURCE,
  paginateCatalog,
  profileDirOf,
  sortByStars,
} from '../src/catalog.ts'
import type { RegistryEntry } from '../src/registry.ts'

describe('catalog', () => {
  it('bounds every source to MAX_PER_SOURCE entries', () => {
    assert.equal(MAX_PER_SOURCE, 2_000)
    assert.ok(MAX_PER_SOURCE > MAX_PAGE_SIZE)
  })

  it('filters the full index before returning a bounded page', () => {
    const entries = Array.from({ length: 125 }, (_, index) => ({
      name: `plugin-${index}`,
      full_name: `owner/plugin-${index}`,
      description: index === 124 ? 'needle' : '',
      url: `https://github.com/owner/plugin-${index}`,
      stars: index,
      updated_at: '',
      topics: [],
      license: null,
      pkg_name: null,
      market_tags: [],
    })) satisfies RegistryEntry[]

    const first = paginateCatalog(entries)
    assert.equal(first.entries.length, DEFAULT_PAGE_SIZE)
    assert.equal(first.total, 125)
    assert.equal(first.hasMore, true)

    const last = paginateCatalog(entries, { page: 3, pageSize: 50 })
    assert.equal(last.entries.length, 25)
    assert.equal(last.hasMore, false)

    const searched = paginateCatalog(entries, { query: 'needle' })
    assert.deepEqual(
      searched.entries.map((entry) => entry.name),
      ['plugin-124'],
    )
    assert.equal(searched.total, 1)
  })

  it('sorts the merged directory by stars descending', () => {
    const entries = [
      { full_name: 'a/x', stars: 5 },
      { full_name: 'b/y', stars: 100 },
      { full_name: 'c/z', stars: 0 },
      { full_name: 'd/w', stars: 42 },
    ] as unknown as RegistryEntry[]
    const sorted = sortByStars(entries)
    assert.deepEqual(
      sorted.map((e) => e.stars),
      [100, 42, 5, 0],
    )
    // input array is not mutated
    assert.equal(entries[0].stars, 5)
  })
  it('exposes the lwmxiaobei community directory adapter', () => {
    const ids = ADAPTERS.map((a) => a.id)
    assert.ok(ids.includes('lwmxiaobei'))
    assert.ok(ids.indexOf('lwmxiaobei') < ids.indexOf('github'))
    const adapter = ADAPTERS.find((a) => a.id === 'lwmxiaobei')
    assert.equal(adapter?.priority, 1)
  })
  it('clamps abusive page sizes', () => {
    const page = paginateCatalog([], { page: -10, pageSize: 10_000 })
    assert.equal(page.page, 1)
    assert.equal(page.pageSize, MAX_PAGE_SIZE)
  })

  it('delegates profileDirOf to the official home resolution', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dsh-catalog-'))
    try {
      assert.equal(profileDirOf('web', tmp), join(tmp, 'profiles', 'web'))
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
