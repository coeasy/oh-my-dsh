import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app, crashReporter } from 'electron'

const LOG_FILE = 'main.log'

/**
 * Initialise crash reporting and file logging. Call before `app.whenReady()`.
 *
 * Native crashes are captured locally under `<userData>/Crashpad` via Electron's
 * crashReporter. Optionally forward them to a remote endpoint when
 * `DSH_CRASH_SUBMIT_URL` is set. JS-level fatal errors are recorded to the log.
 */
export function initObservability(): void {
  const userData = app.getPath('userData')
  ensureLogDir(userData)

  const submitUrl = process.env.DSH_CRASH_SUBMIT_URL ?? ''
  crashReporter.start({
    productName: 'my-dsh',
    companyName: 'my-dsh',
    submitURL: submitUrl,
    uploadToServer: submitUrl.length > 0,
    compress: true,
  })

  process.on('uncaughtException', (error) => {
    writeLog('error', `uncaughtException: ${error?.stack ?? error}`)
  })
  process.on('unhandledRejection', (reason) => {
    writeLog(
      'error',
      `unhandledRejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`,
    )
  })
}

function ensureLogDir(userData: string): void {
  try {
    mkdirSync(join(userData, 'logs'), { recursive: true })
  } catch {
    // never crash on log setup
  }
}

function writeLog(level: string, message: string): void {
  try {
    const stamp = new Date().toISOString()
    appendFileSync(
      join(app.getPath('userData'), 'logs', LOG_FILE),
      `[${stamp}] [${level}] ${message}\n`,
      'utf8',
    )
  } catch {
    // logging must never crash the app
  }
}

export function logInfo(message: string): void {
  writeLog('info', message)
}

export function logWarn(message: string): void {
  writeLog('warn', message)
}

export function logError(message: string, error?: unknown): void {
  const detail =
    error instanceof Error
      ? (error.stack ?? error.message)
      : error === undefined
        ? ''
        : String(error)
  writeLog('error', detail ? `${message}: ${detail}` : message)
}
