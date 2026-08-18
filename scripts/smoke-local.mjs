/**
 * D1 local-smoke: PATH 上有 dsh 才探活，没有则 SKIP（exit 0）。
 * 不下载、不 spawn `dsh web`（那会起真实 Host）。
 */
import { spawnSync } from 'node:child_process'

const cmd = process.platform === 'win32' ? 'dsh.cmd' : 'dsh'
const result = spawnSync(cmd, ['--version'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
  windowsHide: true,
  timeout: 15_000,
})

if (result.error || result.status !== 0) {
  const detail = (result.stderr || result.stdout || result.error?.message || '').trim().slice(0, 400)
  console.log(`SKIP: local dsh not on PATH (${cmd})${detail ? `\n${detail}` : ''}`)
  process.exit(0)
}

const version = (result.stdout || '').trim().split(/\r?\n/u)[0] || '(unparsed)'
console.log(`OK: ${cmd} --version → ${version}`)
