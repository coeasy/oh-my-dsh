import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runHealthCheck, healthCheckReport } from '../src/health-check.ts'

test('healthy engine reports ok', () => {
  const r = runHealthCheck({
    engineRef: 'v0.1.0',
    enginePid: process.pid,
    loopbackPort: 8080,
    readyFileContent: '{"url":"http://127.0.0.1:8080","pid":1}',
    freeDiskMb: 5000,
  })
  assert.equal(r.ok, true)
  assert.equal(r.engineAlive, true)
  assert.equal(r.loopbackReachable, true)
})

test('missing pid marks degraded', () => {
  const r = runHealthCheck({
    engineRef: 'v0.1.0',
    enginePid: 99999999,
    loopbackPort: 8080,
    readyFileContent: '{"url":"http://127.0.0.1:8080"}',
  })
  assert.equal(r.ok, false)
  assert.equal(r.engineAlive, false)
})

test('missing ready file marks degraded', () => {
  const r = runHealthCheck({
    engineRef: 'v0.1.0',
    enginePid: process.pid,
    loopbackPort: 8080,
  })
  assert.equal(r.ok, false)
  assert.equal(r.readyFileFresh, false)
})

test('report is redactable and stable', () => {
  const r = runHealthCheck({
    engineVersion: 'x',
    enginePid: process.pid,
    loopbackPort: 1,
    readyFileContent: '{}',
  })
  const rep = healthCheckReport(r)
  assert.match(rep, /overall=ok/)
  assert.match(rep, /engineVersion=x/)
})
