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

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  context.subscriptions.push(
    vscode.commands.registerCommand('dsh.open', async () => {
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
      const panel = vscode.window.createWebviewPanel(
        'dsh.web',
        'DeepSeek Harness',
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
        },
      )
      try {
        panel.webview.html = panelHtml(host.url)
      } catch (err) {
        await host.stop()
        host = undefined
        panel.dispose()
        await vscode.window.showErrorMessage(`DeepSeek Harness failed to start: ${String(err)}`)
        return
      }
      await vscode.window.showInformationMessage(`DeepSeek Harness running at ${host.url}`)
      panel.onDidDispose(() => {
        /* keep host for the window lifetime; deactivate() / dsh.stop stops it */
      })
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
