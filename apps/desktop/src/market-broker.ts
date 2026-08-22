export type MarketActionKind =
  | 'install'
  | 'update'
  | 'remove'
  | 'toggle'
  | 'restore'
  | 'sync'
  | 'uninstall-market'
  | 'uninstall-app'

export interface MarketActionRequest {
  kind: MarketActionKind
  payload: Record<string, unknown>
}

const ACTIONS = new Set<MarketActionKind>([
  'install',
  'update',
  'remove',
  'toggle',
  'restore',
  'sync',
  'uninstall-market',
  'uninstall-app',
])

function exactOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin
  } catch {
    return undefined
  }
}

export function validateMarketActionRequest(input: unknown): MarketActionRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('invalid marketplace request')
  }
  const value = input as { kind?: unknown; payload?: unknown }
  if (typeof value.kind !== 'string' || !ACTIONS.has(value.kind as MarketActionKind)) {
    throw new Error('invalid marketplace action')
  }
  if (!value.payload || typeof value.payload !== 'object' || Array.isArray(value.payload)) {
    throw new Error('invalid marketplace payload')
  }
  const payload = value.payload as Record<string, unknown>
  if (['install', 'update', 'remove'].includes(value.kind)) {
    if (
      typeof payload.full_name !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(payload.full_name)
    ) {
      throw new Error('invalid marketplace catalog id')
    }
    return { kind: value.kind as MarketActionKind, payload: { full_name: payload.full_name } }
  }
  if (value.kind === 'toggle') {
    if (typeof payload.id !== 'string' || !/^[A-Za-z0-9@._/-]{1,200}$/u.test(payload.id)) {
      throw new Error('invalid marketplace bundle id')
    }
    return { kind: value.kind, payload: { id: payload.id, disabled: payload.disabled === true } }
  }
  if (value.kind === 'restore') {
    const serialized = JSON.stringify(payload.backup ?? null)
    if (serialized.length > 64 * 1024) throw new Error('marketplace backup is too large')
    return { kind: value.kind, payload: { backup: payload.backup } }
  }
  if (value.kind === 'sync') {
    return { kind: value.kind, payload: payload.force === true ? { force: true } : {} }
  }
  return { kind: value.kind as MarketActionKind, payload: {} }
}

export function isTrustedMarketSender(senderUrl: string, harnessUrl: string): boolean {
  const senderOrigin = exactOrigin(senderUrl)
  const harnessOrigin = exactOrigin(harnessUrl)
  return Boolean(senderOrigin && harnessOrigin && senderOrigin === harnessOrigin)
}

export async function executeMarketBrokerAction(input: {
  request: unknown
  senderUrl: string
  harnessUrl: string
  token: string
  confirm(request: MarketActionRequest): Promise<boolean>
  fetchImpl(url: string, init: RequestInit): Promise<Response>
}): Promise<Record<string, unknown>> {
  if (!isTrustedMarketSender(input.senderUrl, input.harnessUrl)) {
    throw new Error('untrusted marketplace sender')
  }
  if (!input.token) throw new Error('marketplace broker is unavailable')
  const request = validateMarketActionRequest(input.request)
  if (!(await input.confirm(request))) return { ok: false, error: 'operation cancelled' }
  const response = await input.fetchImpl(
    new URL(`/coeasy-market/api/${request.kind}`, input.harnessUrl).href,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-dsh-market-broker': input.token,
      },
      body: JSON.stringify(request.payload),
      signal: AbortSignal.timeout(305_000),
    },
  )
  const body = (await response.json()) as Record<string, unknown>
  return { ...body, status: response.status }
}
