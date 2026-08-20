import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  net,
  shell,
  type MessageBoxOptions,
} from 'electron'
import {
  assertLoopbackUrl,
  killMatchingProcesses,
  killProcessTree,
  launchHost,
  writeDevLauncher,
  type RunningHost,
} from '@dsh/client-runtime'
import { hasDeepSeekApiKey, upsertEnvKey } from './api-key.ts'
import { checkForAppUpdates } from './app-update-service.ts'
import { createStatusTray, type StatusTray } from './app-tray.ts'
import { installMarket, isMarketInstalled, killBootstrapProcesses } from './market-bootstrap.ts'
import { executeMarketBrokerAction, type MarketActionRequest } from './market-broker.ts'
import type { RuntimeSnapshot } from './contracts.ts'
import { buildDiagnosticsReport } from './diagnostics.ts'
import { loadDesktopSettings, saveDesktopSettings } from './desktop-settings.ts'
import {
  buildHarnessSpawnOptions,
  loadDotEnvFile,
  resolveSidecarDotEnvPath,
  sanitizeBundledSpawnEnv,
} from './harness-env.ts'
import { ensureLaunchRoot, harnessHomePath, desktopUserDataPath } from './launch-root.ts'
import { LanMobileBridge } from './mobile/lan-mobile-bridge.ts'
import {
  parseRuntimeFile,
  resolveDesktopDownloadUrl,
  resolveEngineLaunch,
  resolvePluginPath,
} from './launch-config.ts'
import {
  QUIT_BUDGET_MS,
  stoppingSnapshot,
  clearEnginePid,
  readEnginePid,
  writeEnginePid,
} from './quit-session.ts'
import { secureWindow } from './security.ts'
import { initObservability, logInfo, logWarn } from './observability.ts'
import { isNewerVersion, parseGithubRepo } from './updates.ts'
import {
  downloadEnginePayload,
  engineVersionDir,
  parseEngineUpdateManifest,
  parseLatestRelease,
} from './engine-updater.ts'
import {
  desktopChromeOptions,
  FILL_VIEWPORT_CSS,
  HARNESS_WINDOW_TITLE,
  NO_DRAG_INTERACTIVES_CSS,
} from './window-chrome.ts'
import { isUsableWorkspace, resolveLaunchDirectory } from './workspace-choice.ts'
import { isAbortedNavigationError, shouldLoadHarnessUrl } from './window-navigation.ts'

let mainWindow: BrowserWindow | undefined
let mobileWindow: BrowserWindow | undefined
let host: RunningHost | undefined
let mobileBridge: LanMobileBridge | undefined
let statusTray: StatusTray | undefined
let lastSnapshot: RuntimeSnapshot = { phase: 'idle', message: 'Harness is not running.', logs: [] }
let lastEnginePid = 0
let launchDirectory = ''
let quitting = false
let forceExiting = false
let failureDialogVisible = false
let setupWaiter: ((result: { workspace: string; apiKey: string }) => void) | undefined
let marketBrokerToken = ''

function moduleDir(): string {
  return dirname(fileURLToPath(import.meta.url))
}

/**
 * Resolve a path to its canonical long form. Portable builds run from
 * %TEMP%, which on some systems is an 8.3 short-name path (e.g.
 * C:\Users\ADMINI~1\...). Electron exposes that short name via
 * process.resourcesPath, and paths handed to the engine sidecar then carry
 * the short name. Node's ESM resolver can fail to load such paths, so we
 * canonicalize every engine-facing path to its long-name form.
 */
function canonicalEnginePath(path: string): string {
  try {
    // realpathSync.native resolves 8.3 short names to their long form, which
    // the engine's ESM loader needs to find files under a short-named %TEMP%.
    return realpathSync.native(path)
  } catch {
    return path
  }
}

function repoRoot(): string {
  return join(moduleDir(), '..', '..', '..')
}

function configureAppIdentity(): void {
  app.setName('my-dsh')
  app.setAppUserModelId('com.mydsh.desktop')
  app.setPath('userData', desktopUserDataPath())
  migrateLegacyUserData()
}

/**
 * One-time migration from the legacy user-data folder name
 * (`dsh-client-desktop`) to the renamed `my-dsh` folder, so existing users
 * keep their workspace, API key and engine settings after the rename. Only
 * copies user-authored configuration, never the engine's runtime state
 * (`profiles`, `node_modules`, `sessions`, `storages`) — those are managed by
 * the engine at first launch and must not be copied, or the engine's symlink
 * handling breaks. Only runs when the new folder is absent but the legacy one
 * exists; the legacy folder is left untouched.
 */
function migrateLegacyUserData(): void {
  const current = app.getPath('userData')
  const legacy = join(app.getPath('appData'), 'dsh-client-desktop')
  if (legacy === current || existsSync(current) || !existsSync(legacy)) return
  const copyIfPresent = (relative: string): void => {
    const src = join(legacy, relative)
    if (!existsSync(src)) return
    const dest = join(current, relative)
    mkdirSync(dirname(dest), { recursive: true })
    try {
      cpSync(src, dest, { recursive: true, force: true })
      if (relative.endsWith('.env')) chmodSync(dest, 0o600)
    } catch (error) {
      console.error(`[my-dsh] migration skipped ${relative}`, error)
    }
  }
  mkdirSync(current, { recursive: true })
  copyIfPresent('desktop-settings.json')
  copyIfPresent(join('harness', 'settings.yaml'))
  copyIfPresent(join('harness', '.env'))
  copyIfPresent(join('harness', '.env.example'))
}

function desktopResourcePath(name: string): string {
  return app.isPackaged ? join(process.resourcesPath, name) : join(moduleDir(), '..', name)
}

function preloadPath(): string {
  return join(moduleDir(), 'preload.cjs')
}

function loadBundledRuntime(): ReturnType<typeof parseRuntimeFile> {
  const path = app.isPackaged
    ? join(process.resourcesPath, 'runtime.json')
    : join(moduleDir(), '..', 'runtime.json')
  if (!existsSync(path)) return {}
  return parseRuntimeFile(readFileSync(path, 'utf8'))
}

function harnessLogPath(): string {
  return join(app.getPath('logs'), 'harness.log')
}

function harnessLocale(): 'en' | 'zh' {
  return app.getLocale().toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

/** Stage labels for the splash window's status line (B6 launch progress). */
const LAUNCH_STAGE_TEXT: Record<string, { en: string; zh: string }> = {
  resolving: { en: 'Locating engine…', zh: '正在定位引擎…' },
  downloading: { en: 'Downloading engine…', zh: '正在下载引擎…' },
  spawning: { en: 'Starting engine…', zh: '正在启动引擎…' },
  'waiting-ready': { en: 'Waiting for engine…', zh: '等待引擎就绪…' },
  ready: { en: 'Ready', zh: '就绪' },
}

function setSplashStatus(text: string): void {
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined
  if (!window) return
  // The splash page exposes #status; update it in place without a preload round-trip.
  window.webContents
    .executeJavaScript(
      `(() => { const el = document.getElementById('status'); if (el) el.textContent = ${JSON.stringify(text)}; })()`,
      true,
    )
    .catch(() => undefined)
}

function launchStageMessage(stage: string): string {
  const label = LAUNCH_STAGE_TEXT[stage] ?? { en: 'Starting…', zh: '正在启动…' }
  return harnessLocale() === 'zh' ? label.zh : label.en
}

function sidecarDotEnvPath(): string {
  return resolveSidecarDotEnvPath(dirname(app.getPath('exe')), process.env.PORTABLE_EXECUTABLE_DIR)
}

function currentApiKeyPresent(): boolean {
  const dshHome = harnessHomePath(app.getPath('userData'))
  return (
    hasDeepSeekApiKey(process.env) ||
    hasDeepSeekApiKey(loadDotEnvFile(sidecarDotEnvPath())) ||
    hasDeepSeekApiKey(loadDotEnvFile(join(dshHome, '.env')))
  )
}

function persistApiKey(apiKey: string): void {
  const trimmed = apiKey.trim()
  if (!trimmed) return
  const dshHome = harnessHomePath(app.getPath('userData'))
  mkdirSync(dshHome, { recursive: true })
  const dest = join(dshHome, '.env')
  const previous = existsSync(dest) ? readFileSync(dest, 'utf8') : ''
  writeFileSync(dest, upsertEnvKey(previous, 'DEEPSEEK_API_KEY', trimmed), 'utf8')
  chmodSync(dest, 0o600)
}

function publishSnapshot(next: RuntimeSnapshot): void {
  lastSnapshot = next
  statusTray?.update(next)
}

function rememberEngine(next: RunningHost | undefined): void {
  host = next
  lastEnginePid = next?.pid ?? 0
  const userData = app.getPath('userData')
  if (next?.pid) writeEnginePid(userData, next.pid)
  else clearEnginePid(userData)
}

function trayIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(moduleDir(), '..', 'build', 'icon.png')
}

function showMainWindow(): void {
  if (lastSnapshot.phase === 'ready' && lastSnapshot.url) {
    void openHarness(lastSnapshot.url).catch(showUnexpectedError)
    return
  }
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : createWindow()
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

function reapRecordedEngine(): void {
  const pid = readEnginePid(app.getPath('userData'))
  if (pid) killProcessTree(pid)
  clearEnginePid(app.getPath('userData'))
}

function dismissUi(): void {
  try {
    statusTray?.destroy()
  } catch {
    // tray already gone
  }
  statusTray = undefined
  if (mobileWindow && !mobileWindow.isDestroyed()) mobileWindow.destroy()
  mobileWindow = undefined
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.removeAllListeners('close')
    mainWindow.close()
  }
}

function forceExit(): void {
  if (forceExiting) return
  forceExiting = true
  quitting = true
  if (lastEnginePid) killProcessTree(lastEnginePid)
  clearEnginePid(app.getPath('userData'))
  dismissUi()
  host = undefined
  mobileBridge = undefined
  app.exit(0)
}

async function quitAll(): Promise<void> {
  if (quitting) return
  quitting = true
  publishSnapshot(stoppingSnapshot(harnessLocale(), launchDirectory))
  dismissUi()
  const budget = setTimeout(() => forceExit(), QUIT_BUDGET_MS)
  try {
    await Promise.all([
      host?.stop().catch(() => undefined),
      mobileBridge?.stop().catch(() => undefined),
    ])
  } finally {
    clearTimeout(budget)
    // Strong reap (plan §退出无残留): close any in-flight bootstrap/install
    // children first, then kill orphaned engine/market processes by command
    // line — this closes the detached/reparented worker gap that taskkill /T
    // cannot reach. Match our own artifacts to keep the blast radius tight.
    killBootstrapProcesses()
    killMatchingProcesses([
      'plugin-marketplace',
      'plugin --profile',
      'apps/cli/lib/bin.js',
      'harness/apps/cli/lib/bin.js',
    ])
    forceExit()
  }
}

function createWindow(): BrowserWindow {
  const dark = nativeTheme.shouldUseDarkColors
  const chrome = desktopChromeOptions(dark)
  const webPreferences = {
    contextIsolation: true,
    nodeIntegration: false,
    preload: preloadPath(),
    sandbox: true,
    webSecurity: true,
  }
  let window: BrowserWindow
  try {
    window = new BrowserWindow({
      width: 1380,
      height: 900,
      minWidth: 900,
      minHeight: 640,
      show: false,
      ...chrome,
      webPreferences,
    })
  } catch {
    window = new BrowserWindow({
      width: 1380,
      height: 900,
      minWidth: 900,
      minHeight: 640,
      show: false,
      title: HARNESS_WINDOW_TITLE,
      autoHideMenuBar: true,
      backgroundColor: chrome.backgroundColor,
      webPreferences,
    })
  }
  window.setMenuBarVisibility(false)
  window.on('page-title-updated', (event) => {
    event.preventDefault()
    window.setTitle(HARNESS_WINDOW_TITLE)
  })
  window.webContents.on('did-finish-load', () => {
    void window.webContents.insertCSS(FILL_VIEWPORT_CSS)
    void window.webContents.insertCSS(NO_DRAG_INTERACTIVES_CSS)
  })
  secureWindow(
    window,
    [desktopResourcePath('splash.html'), desktopResourcePath('setup.html')],
    () => (lastSnapshot.url ? [new URL(lastSnapshot.url).origin] : []),
  )
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = undefined
  })
  window.on('close', (event) => {
    if (quitting || forceExiting) return
    if (process.platform === 'darwin') {
      event.preventDefault()
      window.hide()
      return
    }
    void quitAll()
  })
  mainWindow = window
  return window
}

async function openHarness(url: string): Promise<void> {
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : createWindow()
  if (shouldLoadHarnessUrl(window.webContents.getURL(), url)) {
    try {
      await window.loadURL(url)
    } catch (error) {
      if (isAbortedNavigationError(error)) return
      throw error
    }
  }
  if (lastSnapshot.url !== url || window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

async function showSplash(): Promise<void> {
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : createWindow()
  await window.loadFile(desktopResourcePath('splash.html'))
  if (window.isDestroyed()) return
  window.show()
  window.focus()
}

function showUnexpectedError(error: unknown): void {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
  dialog.showErrorBox('my-dsh encountered an error', message)
}

async function launchHarness(): Promise<void> {
  if (quitting) return
  publishSnapshot({ phase: 'starting', message: 'Starting my-dsh…', logs: [], launchDirectory })
  await showSplash()
  if (quitting) return
  if (host) {
    await host.stop()
    rememberEngine(undefined)
  }
  const bundled = loadBundledRuntime()
  const engine = resolveEngineLaunch({
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    moduleDir: moduleDir(),
    repoRoot: repoRoot(),
    env: process.env,
    runtime: bundled,
  })
  if (engine.cloneBin && engine.dshCommand) {
    writeDevLauncher({ command: engine.dshCommand, cloneBin: engine.cloneBin })
  }
  const canonicalDshCommand = engine.dshCommand ? canonicalEnginePath(engine.dshCommand) : undefined
  const pluginPath = canonicalEnginePath(
    resolvePluginPath({
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      moduleDir: moduleDir(),
    }),
  )
  const dshHome = harnessHomePath(app.getPath('userData'))
  const sidecarEnv = loadDotEnvFile(sidecarDotEnvPath())
  const spawn = buildHarnessSpawnOptions(
    launchDirectory,
    dshHome,
    process.platform,
    process.env,
    sidecarEnv,
  )
  if (engine.mode === 'bundled' && spawn.env) {
    spawn.env = sanitizeBundledSpawnEnv(spawn.env)
  }
  marketBrokerToken = randomBytes(32).toString('base64url')
  spawn.env = {
    ...(spawn.env ?? process.env),
    DSH_MARKET_BROKER_TOKEN: marketBrokerToken,
  }
  try {
    rememberEngine(
      await launchHost({
        workspaceCwd: launchDirectory,
        mode: engine.mode,
        dshCommand: canonicalDshCommand ?? engine.dshCommand,
        downloadUrl: resolveDesktopDownloadUrl({ env: process.env, bundled }),
        pluginPath,
        readyTimeoutMs: 180_000,
        logPath: harnessLogPath(),
        env: spawn.env,
        onProgress: (stage) => {
          const message = launchStageMessage(stage)
          publishSnapshot({
            phase: 'starting',
            message,
            logs: [],
            launchDirectory,
          })
          setSplashStatus(message)
        },
      }),
    )
    if (!host || quitting) return
    assertLoopbackUrl(host.url)
    publishSnapshot({
      phase: 'ready',
      message: 'Harness is ready.',
      logs: [],
      launchDirectory,
      url: host.url,
    })
    await openHarness(host.url)
    // First-run bootstrap: silently install the bundled official marketplace.
    // Respects an intentional uninstall: never auto-reinstall once the user
    // has removed it (marketEverInstalled + marketUserRemoved flags).
    if (!quitting && engine.dshCommand && !isMarketInstalled(dshHome)) {
      const userData = app.getPath('userData')
      const settings = loadDesktopSettings(userData)
      try {
        if (settings.marketUserRemoved) {
          // User removed it intentionally — leave it out.
        } else if (settings.marketEverInstalled) {
          // Was auto-installed before but is now missing (removed via CLI).
          saveDesktopSettings(userData, { ...settings, marketUserRemoved: true })
        } else {
          // First run: bundled marketplace ships with the client; fall back to
          // the repo checkout in development so it works without publishing npm.
          const marketPath = app.isPackaged
            ? join(process.resourcesPath, 'plugin-marketplace')
            : join(repoRoot(), 'plugins', 'plugin-marketplace')
          const boot = await installMarket(engine.dshCommand, marketPath, dshHome)
          if (boot.ok && !quitting) {
            saveDesktopSettings(userData, {
              ...loadDesktopSettings(userData),
              marketEverInstalled: true,
            })
            const zh = harnessLocale() === 'zh'
            const opts: Electron.MessageBoxOptions = {
              type: 'info',
              message: zh ? '已为你开启插件市场' : 'Plugin Marketplace enabled',
              detail: zh
                ? '在 设置 → 插件市场 中浏览并安装社区插件。'
                : 'Browse and install community plugins under Settings → Marketplace.',
            }
            if (mainWindow && !mainWindow.isDestroyed())
              await dialog.showMessageBox(mainWindow, opts)
            else await dialog.showMessageBox(opts)
          } else if (!boot.ok) {
            logWarn(`marketplace bootstrap failed: ${boot.output}`)
          }
        }
      } catch (error) {
        logWarn(`marketplace bootstrap error: ${String(error)}`)
      }
    }
  } catch (error) {
    rememberEngine(undefined)
    publishSnapshot({
      phase: 'failed',
      message: error instanceof Error ? error.message : String(error),
      logs: [],
      launchDirectory,
    })
    await showRuntimeFailure(lastSnapshot)
  }
}

async function showRuntimeFailure(snapshot: RuntimeSnapshot): Promise<void> {
  if (failureDialogVisible || quitting) return
  failureDialogVisible = true
  try {
    while (!quitting && lastSnapshot.phase === 'failed') {
      const zh = harnessLocale() === 'zh'
      const options: MessageBoxOptions = {
        type: 'error',
        title: zh ? 'Harness 未能启动' : 'Harness could not start',
        message: snapshot.message,
        detail: snapshot.launchDirectory
          ? zh
            ? `启动目录：${snapshot.launchDirectory}\n\n可以重试或查看 Harness 日志。`
            : `Launch directory: ${snapshot.launchDirectory}\n\nYou can retry or inspect the Harness log.`
          : zh
            ? '可以重试或查看 Harness 日志。'
            : 'You can retry or inspect the Harness log.',
        buttons: zh ? ['重试', '查看日志', '退出'] : ['Retry', 'Show Log', 'Quit'],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      }
      const result = mainWindow
        ? await dialog.showMessageBox(mainWindow, options)
        : await dialog.showMessageBox(options)
      if (result.response === 0) {
        await launchHarness()
      } else if (result.response === 1) {
        shell.showItemInFolder(harnessLogPath())
        continue
      } else {
        void quitAll()
      }
      if (lastSnapshot.phase !== 'failed') return
      snapshot = lastSnapshot
    }
  } catch (error) {
    showUnexpectedError(error)
  } finally {
    failureDialogVisible = false
  }
}

async function confirmLanBridge(): Promise<boolean> {
  const isChinese = harnessLocale() === 'zh'
  const options: MessageBoxOptions = {
    type: 'warning',
    title: isChinese ? '连接手机' : 'Connect Phone',
    message: isChinese ? '手机桥会在局域网监听。' : 'The phone bridge listens on your private LAN.',
    detail: isChinese
      ? '只接受同一 RFC1918 网段，并需要扫码配对。不要在不可信的 Wi-Fi 上开启。'
      : 'It accepts RFC1918/loopback clients after QR pairing. Do not enable it on untrusted Wi-Fi.',
    buttons: isChinese ? ['继续', '取消'] : ['Continue', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  }
  const result = mainWindow
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options)
  return result.response === 0
}

async function showMobilePairing(): Promise<void> {
  if (!mobileBridge) return
  if (lastSnapshot.phase !== 'ready' || !lastSnapshot.url) {
    const options: MessageBoxOptions = {
      type: 'info',
      message: harnessLocale() === 'zh' ? 'Harness 仍在启动。' : 'Harness is still starting.',
      detail:
        harnessLocale() === 'zh'
          ? '请等桌面客户端就绪后再连接手机。'
          : 'Wait until the desktop client is ready, then connect your phone again.',
      buttons: ['OK'],
    }
    await (mainWindow ? dialog.showMessageBox(mainWindow, options) : dialog.showMessageBox(options))
    return
  }
  if (!mobileBridge.snapshot().running && !(await confirmLanBridge())) return

  const snapshot = await mobileBridge.start()
  if (!snapshot.desktopUrl || !snapshot.pairingUrl) {
    await mobileBridge.stop()
    const options: MessageBoxOptions = {
      type: 'warning',
      message:
        harnessLocale() === 'zh' ? '没有找到可用的局域网。' : 'No private Wi-Fi network was found.',
      detail:
        harnessLocale() === 'zh'
          ? '请把这台电脑连到和手机同一局域网后再试。'
          : 'Connect this computer to the same private Wi-Fi as your phone and try again.',
      buttons: ['OK'],
    }
    await (mainWindow ? dialog.showMessageBox(mainWindow, options) : dialog.showMessageBox(options))
    return
  }

  if (mobileWindow && !mobileWindow.isDestroyed()) mobileWindow.destroy()
  mobileWindow = new BrowserWindow({
    width: 560,
    height: 700,
    minWidth: 420,
    minHeight: 560,
    title: harnessLocale() === 'zh' ? '连接手机' : 'Connect Phone',
    parent: mainWindow,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  secureWindow(mobileWindow, [], [new URL(snapshot.desktopUrl).origin])
  mobileWindow.on('closed', () => {
    mobileWindow = undefined
  })
  await mobileWindow.loadURL(snapshot.desktopUrl)
  mobileWindow.show()
  mobileWindow.focus()
}

async function stopMobileBridge(): Promise<void> {
  if (mobileWindow && !mobileWindow.isDestroyed()) mobileWindow.destroy()
  await mobileBridge?.stop()
}

async function chooseFolder(): Promise<string | undefined> {
  const result = await dialog.showOpenDialog(mainWindow ?? createWindow(), {
    title: harnessLocale() === 'zh' ? '选择工作区' : 'Choose workspace',
    properties: ['openDirectory'],
  })
  if (result.canceled || !result.filePaths[0]) return undefined
  return result.filePaths[0]
}

async function applyWorkspace(folder: string, restart: boolean): Promise<void> {
  if (!isUsableWorkspace(folder)) return
  const userData = app.getPath('userData')
  const settings = loadDesktopSettings(userData)
  saveDesktopSettings(userData, { ...settings, workspace: folder })
  launchDirectory = folder
  if (restart) await launchHarness()
}

async function exportDiagnostics(): Promise<void> {
  const originPath = app.isPackaged
    ? join(process.resourcesPath, 'runtime', 'origin.json')
    : join(moduleDir(), '..', '..', '..', 'runtime', 'payload', 'origin.json')
  let engineRef = ''
  if (existsSync(originPath)) {
    try {
      const origin = JSON.parse(readFileSync(originPath, 'utf8')) as { ref?: unknown }
      if (typeof origin.ref === 'string') engineRef = origin.ref
    } catch {
      engineRef = ''
    }
  }
  const logTail = existsSync(harnessLogPath())
    ? readFileSync(harnessLogPath(), 'utf8').slice(-80_000)
    : ''
  const report = buildDiagnosticsReport({
    appVersion: app.getVersion(),
    engineRef,
    workspace: launchDirectory,
    packaged: app.isPackaged,
    logTail,
  })
  const dest = join(app.getPath('documents'), `dsh-client-diagnostics-${Date.now()}.txt`)
  writeFileSync(dest, report, 'utf8')
  shell.showItemInFolder(dest)
}

async function checkForEngineUpdate(interactive: boolean): Promise<string> {
  const repo = parseGithubRepo(process.env.DSH_GITHUB_REPO)
  const isChinese = harnessLocale() === 'zh'
  if (!repo) {
    const msg = isChinese
      ? '未配置更新源（DSH_GITHUB_REPO）。'
      : 'No engine update source (DSH_GITHUB_REPO).'
    if (interactive) await dialog.showMessageBox({ type: 'info', message: msg, buttons: ['OK'] })
    return msg
  }
  const res = await net.fetch(
    `https://api.github.com/repos/${repo.owner}/${repo.repo}/releases/latest`,
    { headers: { 'User-Agent': 'my-dsh' } },
  )
  if (!res.ok) throw new Error(`engine update: GitHub HTTP ${res.status}`)
  const latest = parseLatestRelease(await res.text())
  if (!latest) {
    const msg = isChinese ? '未能解析最新引擎版本。' : 'Could not parse the latest engine release.'
    if (interactive) await dialog.showMessageBox({ type: 'info', message: msg, buttons: ['OK'] })
    return msg
  }
  const cacheRoot = join(app.getPath('userData'), 'engine-cache')
  const bundledRef = '0.1.0'
  if (!isNewerVersion(latest.ref, bundledRef)) {
    const msg = isChinese ? `引擎已是 ${bundledRef}。` : `Engine is up to date (${bundledRef}).`
    if (interactive) await dialog.showMessageBox({ type: 'info', message: msg, buttons: ['OK'] })
    return msg
  }
  const manifestUrl = process.env.DSH_ENGINE_UPDATE_URL
  let manifestRaw = ''
  if (manifestUrl) {
    let parsedManifestUrl: URL
    try {
      parsedManifestUrl = new URL(manifestUrl)
    } catch {
      parsedManifestUrl = new URL('about:blank')
    }
    if (parsedManifestUrl.protocol !== 'https:') {
      const msg = isChinese
        ? '引擎更新清单必须使用 HTTPS。'
        : 'The engine update manifest must use HTTPS.'
      if (interactive)
        await dialog.showMessageBox({ type: 'warning', message: msg, buttons: ['OK'] })
      return msg
    }
    const manifestResponse = await net.fetch(parsedManifestUrl.href)
    if (!manifestResponse.ok)
      throw new Error(`engine update manifest: HTTP ${manifestResponse.status}`)
    manifestRaw = await manifestResponse.text()
  }
  const manifest = parseEngineUpdateManifest(manifestRaw)
  if (!manifest) {
    const msg = isChinese
      ? `发现新引擎 ${latest.ref}，但未配置可下载清单（DSH_ENGINE_UPDATE_URL）。`
      : `Engine ${latest.ref} available, but no manifest (DSH_ENGINE_UPDATE_URL).`
    if (interactive) await dialog.showMessageBox({ type: 'info', message: msg, buttons: ['OK'] })
    return msg
  }
  await downloadEnginePayload({
    cacheRoot,
    version: manifest.version,
    url: manifest.url,
    checksum: manifest.checksum,
    fetchImpl: (u, init) => net.fetch(u instanceof URL ? u.href : u, init),
  })
  const dir = engineVersionDir(cacheRoot, manifest.version)
  const msg = isChinese
    ? `引擎 ${manifest.version} 已下载并校验，等待后续激活：${dir}`
    : `Engine ${manifest.version} downloaded and verified; activation is pending: ${dir}`
  if (interactive) await dialog.showMessageBox({ type: 'info', message: msg, buttons: ['OK'] })
  return msg
}

async function showSetupIfNeeded(fallback: string): Promise<void> {
  const settings = loadDesktopSettings(app.getPath('userData'))
  launchDirectory = resolveLaunchDirectory(settings.workspace, fallback)
  if (
    isUsableWorkspace(settings.workspace ?? '') &&
    (currentApiKeyPresent() || settings.apiKeyPrompted)
  ) {
    return
  }
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : createWindow()
  const finished = new Promise<{ workspace: string; apiKey: string }>((resolve) => {
    setupWaiter = resolve
  })
  await window.loadFile(desktopResourcePath('setup.html'))
  window.show()
  window.focus()
  const result = await finished
  setupWaiter = undefined
  if (result.workspace) await applyWorkspace(result.workspace, false)
  persistApiKey(result.apiKey)
  const userData = app.getPath('userData')
  saveDesktopSettings(userData, { ...loadDesktopSettings(userData), apiKeyPrompted: true })
}

async function confirmMarketAction(request: MarketActionRequest): Promise<boolean> {
  const zh = harnessLocale() === 'zh'
  const target =
    typeof request.payload.full_name === 'string'
      ? request.payload.full_name
      : request.kind === 'restore'
        ? zh
          ? '备份中的插件集合'
          : 'the plugins in this backup'
        : zh
          ? '当前安装'
          : 'this installation'
  const labels: Record<MarketActionRequest['kind'], { zh: string; en: string }> = {
    install: { zh: '安装插件', en: 'Install plugin' },
    update: { zh: '更新插件', en: 'Update plugin' },
    remove: { zh: '移除插件', en: 'Remove plugin' },
    toggle: { zh: '更改插件状态', en: 'Change plugin state' },
    restore: { zh: '恢复插件备份', en: 'Restore plugin backup' },
    'uninstall-market': { zh: '卸载插件市场', en: 'Uninstall Marketplace' },
    'uninstall-app': { zh: '卸载 my-dsh', en: 'Uninstall my-dsh' },
  }
  const label = zh ? labels[request.kind].zh : labels[request.kind].en
  const options: MessageBoxOptions = {
    type:
      request.kind.startsWith('uninstall') || request.kind === 'remove' ? 'warning' : 'question',
    title: label,
    message: zh ? `确认${label}？` : `${label}?`,
    detail: String(target),
    buttons: zh ? ['继续', '取消'] : ['Continue', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  }
  const result = mainWindow
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options)
  return result.response === 0
}

function installIpc(): void {
  ipcMain.handle('engine:check-update', () =>
    checkForEngineUpdate(true).catch((e) => (e instanceof Error ? e.message : String(e))),
  )
  ipcMain.handle('mobile:open-pairing', () => showMobilePairing())
  ipcMain.handle('mobile:status', () => ({
    connected: mobileBridge?.snapshot().connected === true,
    running: mobileBridge?.snapshot().running === true,
  }))
  ipcMain.handle('desktop:pick-folder', () => chooseFolder())
  ipcMain.handle('desktop:setup-defaults', () => ({
    workspace: launchDirectory,
    hasKey: currentApiKeyPresent(),
  }))
  ipcMain.handle(
    'desktop:complete-setup',
    (_event, payload: { workspace?: unknown; apiKey?: unknown }) => {
      setupWaiter?.({
        workspace: typeof payload?.workspace === 'string' ? payload.workspace : '',
        apiKey: typeof payload?.apiKey === 'string' ? payload.apiKey : '',
      })
      return true
    },
  )
  // When the user has already been prompted for an API key but never
  // configured one, skip the engine's full-screen onboarding takeover so the
  // client opens straight to a usable UI instead of a blocking modal.
  ipcMain.handle('desktop:should-skip-onboarding', () => {
    const settings = loadDesktopSettings(app.getPath('userData'))
    return settings.apiKeyPrompted === true && !currentApiKeyPresent()
  })
  ipcMain.handle('market:action', async (event, request: unknown) => {
    if (!host?.url) return { ok: false, error: 'Harness is not ready' }
    try {
      return await executeMarketBrokerAction({
        request,
        senderUrl: event.senderFrame?.url ?? event.sender.getURL(),
        harnessUrl: host.url,
        token: marketBrokerToken,
        confirm: confirmMarketAction,
        fetchImpl: (url, init) => net.fetch(url, init),
      })
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
}

function installMenu(): void {
  const isChinese = harnessLocale() === 'zh'
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),
    {
      label: isChinese ? '文件' : 'File',
      submenu: [
        {
          label: isChinese ? '打开工作区…' : 'Open Workspace…',
          accelerator: 'CmdOrCtrl+O',
          click: () =>
            void chooseFolder()
              .then((folder) => (folder ? applyWorkspace(folder, true) : undefined))
              .catch(showUnexpectedError),
        },
        {
          label: isChinese ? '导出诊断…' : 'Export Diagnostics…',
          click: () => void exportDiagnostics().catch(showUnexpectedError),
        },
        { type: 'separator' },
        {
          label: isChinese ? '检查更新…' : 'Check for Updates…',
          click: () =>
            void checkForAppUpdates({ interactive: true, locale: harnessLocale() }).catch(
              showUnexpectedError,
            ),
        },
        ...(process.platform === 'darwin'
          ? []
          : [{ type: 'separator' as const }, { role: 'quit' as const }]),
      ],
    },
    {
      label: 'Harness',
      submenu: [
        {
          label: isChinese ? '连接手机…' : 'Connect Phone…',
          accelerator: 'CmdOrCtrl+Shift+M',
          click: () => void showMobilePairing().catch(showUnexpectedError),
        },
        {
          label: isChinese ? '停止手机桥' : 'Stop Phone Bridge',
          click: () => void stopMobileBridge().catch(showUnexpectedError),
        },
        { type: 'separator' },
        {
          label: isChinese ? '重启 Harness' : 'Restart Harness',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => void launchHarness().catch(showUnexpectedError),
        },
        {
          label: isChinese ? '打开 Harness 日志' : 'Show Harness Log',
          click: () => shell.showItemInFolder(harnessLogPath()),
        },
      ],
    },
    {
      label: isChinese ? '编辑' : 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: isChinese ? '查看' : 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: isChinese ? '窗口' : 'Window',
      submenu: [{ role: 'minimize' }, { role: 'close' }],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

async function bootstrap(): Promise<void> {
  // Register IPC handlers before any window/page loads: the preload calls
  // mobile:status on every page (including splash), which would otherwise
  // race ahead of installIpc() and log "No handler registered".
  installIpc()
  createWindow()
  await showSplash()
  reapRecordedEngine()
  const fallback = await ensureLaunchRoot(app.getPath('userData'))
  statusTray = createStatusTray({
    iconPath: trayIconPath(),
    locale: harnessLocale(),
    snapshot: lastSnapshot,
    onShow: showMainWindow,
    onMarket: showMainWindow,
    onRestart: () => {
      if (!quitting) void launchHarness().catch(showUnexpectedError)
    },
    onQuit: () => {
      void quitAll()
    },
  })
  mobileBridge = new LanMobileBridge({
    harnessUrl: () => lastSnapshot.url,
    locale: harnessLocale,
    port: app.isPackaged ? 43127 : 43128,
  })
  installMenu()
  await showSetupIfNeeded(fallback)
  const settings = loadDesktopSettings(app.getPath('userData'))
  if (settings.autoUpdate !== false && app.isPackaged) {
    void checkForAppUpdates({ interactive: false, locale: harnessLocale() }).catch(() => undefined)
  }
  await launchHarness()
}

configureAppIdentity()
initObservability()
logInfo('app starting')
const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showMainWindow()
  })
  app
    .whenReady()
    .then(bootstrap)
    .catch((error: unknown) => {
      showUnexpectedError(error)
      void quitAll()
    })
  app.on('activate', () => {
    if (quitting) return
    showMainWindow()
    if (lastSnapshot.phase === 'idle') {
      void launchHarness().catch(showUnexpectedError)
    }
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !quitting) void quitAll()
  })
  app.on('before-quit', (event) => {
    if (forceExiting) return
    event.preventDefault()
    if (!quitting) void quitAll()
  })
}
