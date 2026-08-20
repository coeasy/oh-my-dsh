import { app, dialog, net, shell } from 'electron'
import { isNewerVersion, parseGithubRepo } from './updates.ts'

export type AppUpdateLocale = 'en' | 'zh'

/** UI-only release check kept outside main.ts so update policy is testable. */
export async function checkForAppUpdates(input: {
  interactive: boolean
  locale: AppUpdateLocale
  repo?: string
  fetchImpl?: typeof net.fetch
}): Promise<void> {
  const repo = parseGithubRepo(input.repo ?? process.env.DSH_GITHUB_REPO)
  const isChinese = input.locale === 'zh'
  const fetchImpl = input.fetchImpl ?? net.fetch
  if (!repo) {
    if (input.interactive) {
      await dialog.showMessageBox({
        type: 'info',
        message: isChinese ? '未配置更新源。' : 'Update source is not configured.',
        detail: isChinese
          ? '设置环境变量 DSH_GITHUB_REPO=owner/repo 后即可检查 GitHub Releases。'
          : 'Set DSH_GITHUB_REPO=owner/repo to check GitHub Releases.',
        buttons: ['OK'],
      })
    }
    return
  }
  const response = await fetchImpl(
    `https://api.github.com/repos/${repo.owner}/${repo.repo}/releases/latest`,
    { headers: { 'User-Agent': 'my-dsh' } },
  )
  if (!response.ok) throw new Error(`GitHub releases HTTP ${response.status}`)
  const body = (await response.json()) as { tag_name?: unknown; html_url?: unknown }
  const latest = typeof body.tag_name === 'string' ? body.tag_name : ''
  const url = typeof body.html_url === 'string' ? body.html_url : ''
  if (!latest || !isNewerVersion(latest, app.getVersion())) {
    if (input.interactive) {
      await dialog.showMessageBox({
        type: 'info',
        message: isChinese ? '已是最新版本。' : 'You are on the latest version.',
        buttons: ['OK'],
      })
    }
    return
  }
  if (!input.interactive) return
  const result = await dialog.showMessageBox({
    type: 'info',
    message: isChinese ? `发现 ${latest}` : `Update ${latest} is available`,
    detail: isChinese
      ? '打开 GitHub Release 下载，并核对 SHA256SUMS.txt。'
      : 'Open the GitHub Release and verify SHA256SUMS.txt.',
    buttons: isChinese ? ['打开', '稍后'] : ['Open', 'Later'],
    defaultId: 0,
    cancelId: 1,
  })
  if (result.response === 0 && url) await shell.openExternal(url)
}
