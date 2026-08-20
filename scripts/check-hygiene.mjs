/**
 * Fail if the published-tree hygiene files are missing, if the engine clone
 * is not gitignored, or if unpublished dumps are tracked.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ENGINE_CLONE_DIRNAME } from './engine-root.mjs'
import { assertAlignedVersions } from './product-version.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const required = [
  'LICENSE',
  'NOTICE',
  'SECURITY.md',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'SUPPORT.md',
  'AGENTS.md',
  '.editorconfig',
  '.gitattributes',
  '.nvmrc',
  '.env.example',
  'engine.lock.json',
  '.gitignore',
  '.github/CODEOWNERS',
  '.github/dependabot.yml',
  '.github/pull_request_template.md',
  '.github/workflows/ci.yml',
  '.github/workflows/release.yml',
  '.github/workflows/version.yml',
  '.changeset/config.json',
  '.github/ISSUE_TEMPLATE/bug.yml',
  '.github/ISSUE_TEMPLATE/feature.yml',
  '.github/ISSUE_TEMPLATE/config.yml',
  'apps/desktop/build/icon.png',
  'scripts/engine-root.mjs',
  'scripts/git-refs.mjs',
  'scripts/github-engine.mjs',
  'scripts/build-clients.mjs',
  'scripts/build-engine.mjs',
  'scripts/install-clients.mjs',
  'scripts/client-scenarios.mjs',
  'scripts/app-resources-dir.mjs',
  'scripts/product-version.mjs',
  'build-clients.cmd',
  'build-clients.ps1',
  'build-clients.sh',
  'install-clients.cmd',
  'install-clients.ps1',
  'install-clients.sh',
  'docs/one-click-clients.md',
  'docs/development.md',
  'docs/architecture.md',
  'docs/publishing.md',
]

let failed = false
for (const relative of required) {
  const path = join(root, relative)
  if (!existsSync(path)) {
    console.error(`hygiene: missing ${relative}`)
    failed = true
  }
}

const ignore = readFileSync(join(root, '.gitignore'), 'utf8')
if (!ignore.split(/\r?\n/u).some((line) => line.trim() === `/${ENGINE_CLONE_DIRNAME}/`)) {
  console.error(`hygiene: .gitignore must contain /${ENGINE_CLONE_DIRNAME}/`)
  failed = true
}

const scriptDir = join(root, 'scripts')
const banned = ['docs', 'competitive-analysis', 'deepseek-harness'].join('/')
for (const name of readdirSync(scriptDir)) {
  if (!name.endsWith('.mjs') && !name.endsWith('.cjs')) continue
  const text = readFileSync(join(scriptDir, name), 'utf8')
  if (text.includes(banned)) {
    console.error(`hygiene: ${name} still hardcodes ${banned}`)
    failed = true
  }
}

const listed = spawnSync(
  'git',
  ['ls-files', '-z', '--', ENGINE_CLONE_DIRNAME, 'docs/competitive-analysis'],
  {
    cwd: root,
    encoding: 'buffer',
    windowsHide: true,
  },
)
if (listed.status === 0) {
  const tracked = String(listed.stdout || '')
    .split('\0')
    .map((line) => line.trim())
    .filter(Boolean)
  for (const file of tracked) {
    console.error(`hygiene: unpublished path is tracked: ${file}`)
    failed = true
  }
}

// Fail if stale build/residue directories accumulate under runtime/ or tests/.
const stalePatterns = [
  (name) => /^payload\.stale/.test(name),
  (name) => /^stage\.broken/.test(name),
  (name) => /^win-unpacked\.stale/.test(name),
]
for (const dir of ['runtime', 'tests']) {
  const base = join(root, dir)
  if (!existsSync(base)) continue
  for (const name of readdirSync(base)) {
    if (stalePatterns.some((p) => p(name))) {
      console.error(`hygiene: stale residue present: ${dir}/${name}`)
      failed = true
    }
  }
}
// Fail if agent/session residue was committed under tests/generated (gitignored).
const generatedDir = join(root, 'tests', 'generated')
if (
  existsSync(generatedDir) &&
  readdirSync(generatedDir).filter((n) => n !== '.gitkeep').length > 0
) {
  console.error(`hygiene: tests/generated contains residue; clean it or keep only .gitkeep`)
  failed = true
}

if (failed) process.exit(1)
try {
  const version = assertAlignedVersions(root)
  console.log(`OK: hygiene files present; product ${version}`)
} catch (error) {
  console.error(`hygiene: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
