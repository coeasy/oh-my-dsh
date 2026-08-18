import { assertLoopbackUrl } from './loopback.ts'
import type { ReadyPayload } from './types.ts'

const STDOUT_URL = /dsh web:\s*(https?:\/\/127\.0\.0\.1:\d+)/u

export function parseStdoutUrl(chunk: string): string | undefined {
  const match = STDOUT_URL.exec(chunk)
  return match?.[1]
}

export function parseReadyFile(text: string): ReadyPayload {
  const payload = JSON.parse(text) as ReadyPayload
  if (!payload?.url || !payload.port) {
    throw new Error('ready file missing url/port')
  }
  assertLoopbackUrl(payload.url)
  return payload
}

export function urlToPort(url: string): number {
  const parsed = new URL(url)
  const port = Number(parsed.port)
  if (!port) throw new Error(`cannot read port from ${url}`)
  return port
}
