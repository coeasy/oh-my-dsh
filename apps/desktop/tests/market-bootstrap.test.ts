import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import {
  installedMarketVersion,
  marketBundledVersion,
  marketNeedsRefresh,
} from '../src/market-bootstrap.ts'

const dirs: string[] = []
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'dsh-market-boot-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs.length = 0
})

const writeManifest = (dshHome: string, marketVersion: string): void => {
  const dir = join(dshHome, 'profiles', 'web', 'node_modules', '@coeasy', 'dsh-plugin-marketplace')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: '@coeasy/dsh-plugin-marketplace', version: marketVersion }),
  )
}

describe('market version freshness', () => {
  it('reads the bundled version from the packaged checkout', () => {
    const market = tmp()
    writeFileSync(
      join(market, 'package.json'),
      JSON.stringify({ name: '@coeasy/dsh-plugin-marketplace', version: '0.1.0-build.abc123' }),
    )
    assert.equal(marketBundledVersion(market), '0.1.0-build.abc123')
  })
  it('returns null for a missing/invalid bundled manifest', () => {
    const market = tmp()
    assert.equal(marketBundledVersion(market), null)
    writeFileSync(join(market, 'package.json'), 'not-json')
    assert.equal(marketBundledVersion(market), null)
  })
  it('reads the installed market version under a DSH_HOME', () => {
    const home = tmp()
    writeManifest(home, '0.1.0-build.def456')
    assert.equal(installedMarketVersion(home), '0.1.0-build.def456')
    assert.equal(installedMarketVersion(tmp()), null) // not installed
  })
  it('needs refresh only when installed and versions differ', () => {
    const home = tmp()
    writeManifest(home, '0.1.0-build.def456')
    // Same build → fresh.
    assert.equal(marketNeedsRefresh(home, '0.1.0-build.def456'), false)
    // Different build (stale file: snapshot) → refresh.
    assert.equal(marketNeedsRefresh(home, '0.1.0-build.999999'), true)
    // No bundled version → never refresh (dev fallback).
    assert.equal(marketNeedsRefresh(home, null), false)
    // Not installed at all → install path, not refresh.
    assert.equal(marketNeedsRefresh(tmp(), '0.1.0-build.abc123'), false)
  })
})
