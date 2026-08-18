/**
 * @dsh/plugin-embedded-client
 * Cordis function plugin: after webServer binds, write a ready file the
 * outer client-runtime can poll. Does not import vscode or electron.
 */

import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { assertSafeReadyPath } from './safe-path.ts'

/** Duck-typed Cordis context — avoid a hard dependency on @deepseek-ai/cordis. */
export interface EmbeddedContext {
  webServer: { port: number; host: string }
  on(event: 'dispose', listener: () => void): void
}

export interface EmbeddedConfig {
  readyPath?: string
  workspaceCwd?: string
}

export const name = 'embedded-client'
export const inject = ['webServer']

export interface ReadyPayload {
  url: string
  host: string
  port: number
  pid: number
  workspaceCwd?: string
}

export function buildReadyPayload(
  ctx: Pick<EmbeddedContext, 'webServer'>,
  config: EmbeddedConfig = {},
): ReadyPayload {
  const host = ctx.webServer.host || '127.0.0.1'
  if (host !== '127.0.0.1') {
    throw new Error(`embedded-client: refusing non-loopback host ${host}`)
  }
  const port = ctx.webServer.port
  if (!port || port <= 0) {
    throw new Error('embedded-client: webServer.port is not bound yet')
  }
  const payload: ReadyPayload = {
    url: `http://${host}:${port}`,
    host,
    port,
    pid: process.pid,
  }
  if (config.workspaceCwd) payload.workspaceCwd = config.workspaceCwd
  return payload
}

export function writeReadyFile(readyPath: string, payload: ReadyPayload): void {
  const safe = assertSafeReadyPath(readyPath)
  mkdirSync(dirname(safe), { recursive: true })
  writeFileSync(safe, `${JSON.stringify(payload)}\n`, 'utf8')
}

export function apply(ctx: EmbeddedContext, config: EmbeddedConfig = {}): void {
  const readyPath = config.readyPath || process.env.DSH_READY_FILE
  if (!readyPath) {
    throw new Error('embedded-client: DSH_READY_FILE / config.readyPath is required')
  }
  const payload = buildReadyPayload(ctx, config)
  const safe = assertSafeReadyPath(readyPath)
  writeReadyFile(safe, payload)
  ctx.on('dispose', () => {
    try {
      unlinkSync(safe)
    } catch {
      // best-effort
    }
  })
}
