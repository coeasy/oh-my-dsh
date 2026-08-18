import { redactSecrets } from './api-key.ts'

export interface HealthCheckInput {
  engineRef?: string
  enginePid?: number
  loopbackPort?: number
  readyFileContent?: string
  freeDiskMb?: number
  engineVersion?: string
}

export interface HealthCheckResult {
  engineRef: string
  engineVersion: string
  engineAlive: boolean
  loopbackReachable: boolean
  readyFileFresh: boolean
  freeDiskMb: number
  ok: boolean
}

function isPidAlive(pid: number | undefined): boolean {
  if (pid === undefined || pid <= 0) return false
  try {
    // 0 表示成功（进程存在），非 0 表示进程不存在/无权限
    process.kill(pid, 0)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return code === 'EPERM' // 存在但无权限操作
  }
}

/**
 * 健康自检（纯函数，便于单测）。loopback 可达性仅依据端口存在与否判定，
 * 真实 HTTP 探测由调用方（主进程）执行后传入 reachable 结果。
 */
export function runHealthCheck(input: HealthCheckInput): HealthCheckResult {
  const engineAlive = isPidAlive(input.enginePid)
  const loopbackReachable =
    input.loopbackPort !== undefined &&
    input.loopbackPort > 0 &&
    (input.readyFileContent?.length ?? 0) > 0
  const readyFileFresh = (input.readyFileContent?.length ?? 0) > 0
  const freeDiskMb = input.freeDiskMb ?? 0
  const ok =
    engineAlive &&
    loopbackReachable &&
    readyFileFresh &&
    (input.engineRef !== undefined || input.engineVersion !== undefined)
  return {
    engineRef: input.engineRef ?? 'unknown',
    engineVersion: input.engineVersion ?? 'unknown',
    engineAlive,
    loopbackReachable,
    readyFileFresh,
    freeDiskMb,
    ok,
  }
}

export function healthCheckReport(result: HealthCheckResult): string {
  const lines = [
    'my-dsh health',
    `engineRef=${result.engineRef}`,
    `engineVersion=${result.engineVersion}`,
    `engineAlive=${result.engineAlive ? 'true' : 'false'}`,
    `loopbackReachable=${result.loopbackReachable ? 'true' : 'false'}`,
    `readyFileFresh=${result.readyFileFresh ? 'true' : 'false'}`,
    `freeDiskMb=${result.freeDiskMb}`,
    `overall=${result.ok ? 'ok' : 'degraded'}`,
    '',
  ]
  return lines.join('\n')
}

export { redactSecrets }
