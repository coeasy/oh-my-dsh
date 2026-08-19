import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MARKET_PACKAGE } from '../src/uninstall.ts'

describe('uninstall', () => {
  it('exposes the official market package name for CLI removal', () => {
    assert.equal(MARKET_PACKAGE, '@coeasy/dsh-plugin-marketplace')
  })
})
