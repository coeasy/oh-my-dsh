import { existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchHost, writeDevLauncher, type RunningHost } from '@dsh/client-runtime'
import * as vscode from 'vscode'
import { panelHtml } from './panel.ts'
import { resolveVscodeEngineLaunch } from './runtime-mode.ts'

let host: RunningHost | undefined
let marketBrokerToken = ''

const MARKET_ACTIONS = new Set([
  'install',
  'update',
  'remove',
  'toggle',
  'restore',
  'uninstall-market',
  'uninstall-app',
])

function marketPayload(kind: string, raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid payload')
  const payload = raw as Record<string, unknown>
  if (kind === 'install' || kind === 'update' || kind === 'remove') {
    const fullName = payload.full_name
    if (
      typeof fullName !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(fullName)
    ) {
      throw new Error('invalid catalog id')
    }
    return { full_name: fullName }
  }
  if (kind === 'restore') {
    if (JSON.stringify(payload.backup ?? null).length > 64 * 1024)
      throw new Error('backup too large')
    return { backup: payload.backup }
  }
  if (kind === 'toggle') {
    if (typeof payload.id !== 'string' || !/^[A-Za-z0-9@._/-]{1,200}$/u.test(payload.id)) {
      throw new Error('invalid bundle id')
    }
    return { id: payload.id, disabled: payload.disabled === true }
  }
  return {}
}

async function handleMarketMessage(panel: vscode.WebviewPanel, message: unknown): Promise<void> {
  const input = message as {
    channel?: unknown
    requestId?: unknown
    kind?: unknown
    payload?: unknown
  }
  if (
    input?.channel !== 'dsh-market-request' ||
    typeof input.requestId !== 'string' ||
    typeof input.kind !== 'string' ||
    !MARKET_ACTIONS.has(input.kind)
  ) {
    return
  }
  const reply = (result?: unknown, error?: string): Thenable<boolean> =>
    panel.webview.postMessage({
      channel: 'dsh-market-response',
      requestId: input.requestId,
      result,
      error,
    })
  try {
    if (!host?.url || !marketBrokerToken)
      throw new Error('Harness marketplace broker is unavailable')
    const payload = marketPayload(input.kind, input.payload)
    const target = typeof payload.full_name === 'string' ? `: ${payload.full_name}` : ''
    const choice = await vscode.window.showWarningMessage(
      `Allow marketplace action “${input.kind}”${target}?`,
      { modal: true },
      'Continue',
    )
    if (choice !== 'Continue') {
      await reply({ ok: false, error: 'operation cancelled' })
      return
    }
    const response = await fetch(new URL(`/coeasy-market/api/${input.kind}`, host.url), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-dsh-market-broker': marketBrokerToken,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(125_000),
    })
    const result = (await response.json()) as Record<string, unknown>
    await reply({ ...result, status: response.status })
  } catch (error) {
    await reply(undefined, error instanceof Error ? error.message : String(error))
  }
}

function bundledPluginPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'embedded-client.js')
}

function repoRoot(extensionPath: string): string {
  return join(extensionPath, '..', '..')
}

/** Start the harness (if needed) and open a webview panel titled `title`. */
async function startAndOpen(
  context: vscode.ExtensionContext,
  title: string,
  notice: string,
): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  if (!folder) {
    await vscode.window.showErrorMessage('DeepSeek Harness: open a workspace folder first')
    return
  }
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Starting DeepSeek Harness…' },
      async () => {
        if (!host) {
          const cfg = vscode.workspace.getConfiguration('dsh')
          const configured = cfg.get<'local' | 'download'>('runtime')
          const engine = resolveVscodeEngineLaunch({
            production: context.extensionMode === vscode.ExtensionMode.Production,
            configured,
            repoRoot: repoRoot(context.extensionPath),
            exists: existsSync,
          })
          if (engine.cloneBin && engine.dshCommand) {
            writeDevLauncher({ command: engine.dshCommand, cloneBin: engine.cloneBin })
          }
          const downloadUrl = cfg.get<string>('downloadUrl') || undefined
          marketBrokerToken = randomBytes(32).toString('base64url')
          host = await launchHost({
            workspaceCwd: folder,
            mode: engine.mode,
            dshCommand: engine.dshCommand,
            downloadUrl: downloadUrl || undefined,
            pluginPath: bundledPluginPath(),
            env: { ...process.env, DSH_MARKET_BROKER_TOKEN: marketBrokerToken },
          })
        }
      },
    )
  } catch (err) {
    if (host) {
      await host.stop()
      host = undefined
    }
    await vscode.window.showErrorMessage(`DeepSeek Harness failed to start: ${String(err)}`)
    return
  }
  if (!host) return
  const panel = vscode.window.createWebviewPanel('dsh.web', title, vscode.ViewColumn.Beside, {
    enableScripts: true,
    retainContextWhenHidden: true,
  })
  panel.webview.onDidReceiveMessage((message) => handleMarketMessage(panel, message))
  try {
    panel.webview.html = panelHtml(host.url, randomBytes(18).toString('base64url'))
  } catch (err) {
    await host.stop()
    host = undefined
    panel.dispose()
    await vscode.window.showErrorMessage(`DeepSeek Harness failed to start: ${String(err)}`)
    return
  }
  await vscode.window.showInformationMessage(notice)
  panel.onDidDispose(() => {
    /* keep host for the window lifetime */
  })
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  context.subscriptions.push(
    vscode.commands.registerCommand('dsh.open', async () => {
      await startAndOpen(
        context,
        'DeepSeek Harness',
        `DeepSeek Harness running at ${host?.url ?? ''}`,
      )
    }),
    vscode.commands.registerCommand('dsh.marketplace.open', async () => {
      await startAndOpen(
        context,
        '插件市场 · Plugin Marketplace',
        '插件市场已打开：在 设置 → 插件市场 中浏览并安装社区插件。',
      )
    }),
    vscode.commands.registerCommand('dsh.stop', async () => {
      if (!host) {
        await vscode.window.showInformationMessage('DeepSeek Harness is not running')
        return
      }
      await host.stop()
      host = undefined
      marketBrokerToken = ''
      await vscode.window.showInformationMessage('DeepSeek Harness stopped')
    }),
  )
}

export async function deactivate(): Promise<void> {
  if (host) {
    await host.stop()
    host = undefined
  }
  marketBrokerToken = ''
}
