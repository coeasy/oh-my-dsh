/**
 * CI publish step for the changesets release loop.
 *
 * This project does NOT publish to npm — releasing means cutting a `v*` git
 * tag so that .github/workflows/release.yml builds and uploads the artifacts.
 *
 * Runs after `changesets/action` bumps versions on `main` (the merged
 * "Version Packages" PR). It reads the new root version, commits any leftover
 * changes, tags `v<version>` and pushes the tag to trigger the release build.
 *
 * Git auth is provided by actions/checkout (GITHUB_TOKEN).
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = pkg.version
const tag = `v${version}`

const run = (cmd, args) =>
  execFileSync(cmd, args, { stdio: 'inherit', cwd: root })

// Changesets/actions/checkout do not always configure a committer identity.
run('git', ['config', 'user.name', 'github-actions[bot]'])
run('git', [
  'config',
  'user.email',
  '41898282+github-actions[bot]@users.noreply.github.com',
])

// Commit any leftover version bumps (e.g. lockfile) if present.
run('git', ['add', '-A'])
try {
  execFileSync('git', ['diff', '--cached', '--quiet'], { cwd: root })
} catch {
  run('git', ['commit', '-m', `chore: release ${tag}`])
}

run('git', ['tag', '-a', tag, '-m', `Release ${tag}`])
run('git', ['push', 'origin', tag])

console.log(`Pushed release tag ${tag}`)
