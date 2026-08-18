/**
 * Client pack scenarios. Defaults follow the host OS: Windows packs NSIS /
 * portable / zip, macOS packs dmg / zip, Linux packs AppImage / zip.
 * Cross-OS targets fail loud — electron-builder and the bundled Node binary
 * are native to the machine that runs the pack.
 */
export const CLIENT_SCENARIOS = [
  { id: 'vscode', artifact: 'apps/vscode/*.vsix', label: 'VS Code / Cursor VSIX' },
  { id: 'nsis', artifact: 'apps/desktop/dist-release/my-dsh-Setup-*.exe', label: 'Windows NSIS installer' },
  { id: 'portable', artifact: 'apps/desktop/dist-release/my-dsh-*-portable.exe', label: 'Windows portable exe' },
  { id: 'zip', artifact: 'apps/desktop/dist-release/my-dsh-*-*.zip', label: 'Folder zip for this OS' },
  { id: 'dmg', artifact: 'apps/desktop/dist-release/my-dsh-*.dmg', label: 'macOS disk image' },
  { id: 'appimage', artifact: 'apps/desktop/dist-release/my-dsh-*.AppImage', label: 'Linux AppImage' },
]

export const PLATFORM_SCENARIOS = {
  win32: ['vscode', 'nsis', 'portable', 'zip'],
  darwin: ['vscode', 'dmg', 'zip'],
  linux: ['vscode', 'appimage', 'zip'],
}

const ALL_IDS = new Set(CLIENT_SCENARIOS.map((item) => item.id))

export function defaultClientScenarios(platform = process.platform) {
  return PLATFORM_SCENARIOS[platform] || PLATFORM_SCENARIOS.linux
}

export function parseClientScenarios(raw, platform = process.platform) {
  const defaults = defaultClientScenarios(platform)
  const text = String(raw || '').trim()
  if (!text || text === 'all') return defaults
  const ids = text
    .split(/[,\s]+/u)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
  if (ids.length === 0) return defaults
  for (const id of ids) {
    if (!ALL_IDS.has(id)) {
      throw new Error(`unknown client scenario ${id}; expected ${[...ALL_IDS].join('|')}`)
    }
  }
  return assertScenariosForPlatform([...new Set(ids)], platform)
}

export function assertScenariosForPlatform(ids, platform = process.platform) {
  const supported = new Set(defaultClientScenarios(platform))
  for (const id of ids) {
    if (!supported.has(id)) {
      throw new Error(
        `${id} cannot be packed on ${platform}; this OS supports ${[...supported].join(', ')}`,
      )
    }
  }
  return ids
}

/** electron-builder CLI flags for the selected desktop scenarios. */
export function electronBuilderArgs(ids, platform = process.platform) {
  const args = []
  for (const id of ids) {
    if (id === 'vscode') continue
    if (id === 'nsis') args.push('--win', 'nsis')
    else if (id === 'portable') args.push('--win', 'portable')
    else if (id === 'dmg') args.push('--mac', 'dmg')
    else if (id === 'appimage') args.push('--linux', 'AppImage')
    else if (id === 'zip') {
      if (platform === 'win32') args.push('--win', 'zip')
      else if (platform === 'darwin') args.push('--mac', 'zip')
      else args.push('--linux', 'zip')
    }
  }
  return args
}
