import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchHost, writeDevLauncher, type RunningHost } from '@dsh/client-runtime'
import * as vscode from 'vscode'
import { panelHtml } from './panel.ts'
import { resolveVscodeEngineLaunch } from './runtime-mode.ts'

let host: RunningHost | undefined

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
          const inspect = cfg.inspect<'local' | 'download'>('runtime')
          const configured = inspect?.workspaceValue ?? inspect?.globalValue
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
          host = await launchHost({
            workspaceCwd: folder,
            mode: engine.mode,
            dshCommand: engine.dshCommand,
            downloadUrl: downloadUrl || undefined,
            pluginPath: bundledPluginPath(),
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
  try {
    panel.webview.html = panelHtml(host.url)
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
      await vscode.window.showInformationMessage('DeepSeek Harness stopped')
    }),
  )
}

export async function deactivate(): Promise<void> {
  if (host) {
    await host.stop()
    host = undefined
  }
}
