import { redactSecrets } from './api-key.ts'

export interface DiagnosticsInput {
  appVersion: string
  engineRef?: string
  workspace?: string
  packaged: boolean
  logTail?: string
}

export function buildDiagnosticsReport(input: DiagnosticsInput): string {
  const lines = [
    'my-dsh diagnostics',
    `appVersion=${input.appVersion}`,
    `engineRef=${input.engineRef ?? 'unknown'}`,
    `packaged=${input.packaged ? 'true' : 'false'}`,
    `workspace=${input.workspace ?? ''}`,
    `platform=${process.platform}`,
    `arch=${process.arch}`,
    '',
    '--- harness.log (redacted tail) ---',
    redactSecrets(input.logTail ?? ''),
    '',
  ]
  return lines.join('\n')
}
