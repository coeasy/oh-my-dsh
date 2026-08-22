/**
 * Build the fetched DeepSeek Harness clone in place. Does not edit kernel
 * sources: only pnpm install + documented build scripts.
 */
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defaultEngineRoot } from './engine-root.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dest = defaultEngineRoot(root)
const pkg = join(dest, 'package.json')
if (!existsSync(pkg)) {
  throw new Error(`build-engine: missing ${pkg} — run pnpm fetch:engine first`)
}

function run(command, args, { quiet = false, check = true, env = process.env, useShell = true } = {}) {
  const runEnv = quiet ? { ...env, PNPM_CONFIG_REPORTER: 'silent' } : env
  const result = spawnSync(command, args, {
    cwd: dest,
    encoding: 'utf8',
    // Shell mode is required to resolve `.cmd` shims like `pnpm`. But shell
    // mode splits a command line on spaces, so any executable living under a
    // directory whose path contains spaces (e.g. a portable Node under
    // `...\WPS 灵犀\...`) is truncated to its first segment and cmd.exe then
    // fails with “not recognized as an internal or external command”. For
    // such bare executables spawn without a shell — Node quotes the path
    // itself and the process starts correctly.
    shell: process.platform === 'win32' && useShell,
    windowsHide: true,
    stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    timeout: 3_600_000,
    env: runEnv,
  })
  if (check && result.status !== 0) {
    if (quiet) {
      if (result.stdout) process.stdout.write(result.stdout)
      if (result.stderr) process.stderr.write(result.stderr)
    }
    throw new Error(`build-engine: ${command} ${args.join(' ')} failed (exit ${result.status})`)
  }
  return result
}

// The Harness workspace contains optional native packages, examples, and
// cyclic test-only packages that are not part of the desktop runtime. Keep
// pnpm's install diagnostics out of the product build while still replaying
// the complete output when a command fails.
run('pnpm', ['--reporter=silent', 'install', '--frozen-lockfile'], { quiet: true })

// pnpm/setup distributes pnpm 11 as a native executable. Harness's build
// launcher invokes `process.execPath` on `npm_execpath`, so handing that native
// ELF/Mach-O/PE file to Node fails before the actual build starts. Give the
// launcher a disposable Node-compatible bridge that delegates to the native
// pnpm executable while preserving the same arguments and environment.
const pnpmExecBridge = join(root, '.dsh-pnpm-exec.cjs')
writeFileSync(
  pnpmExecBridge,
  "const { spawnSync } = require('node:child_process')\nconst result = spawnSync('pnpm', process.argv.slice(2), { stdio: 'inherit', shell: process.platform === 'win32', env: process.env })\nif (result.error) throw result.error\nprocess.exit(result.status ?? 1)\n",
  'utf8',
)
const harnessEnv = { ...process.env, npm_execpath: pnpmExecBridge }
try {
  const harnessBuild = join(dest, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  run(process.execPath, [harnessBuild, 'scripts/build.ts'], {
    quiet: true,
    env: harnessEnv,
    useShell: false,
  })

  // The upstream web config deliberately reports oversized language/vendor
  // chunks. The build layout already puts those chunks behind stable boundaries;
  // supply the documented Vite limit through a disposable overlay so the clone
  // remains untouched and the warning is not emitted by release builds.
  const webConfig = '.dsh-vite-ci.config.ts'
  writeFileSync(
    join(dest, 'apps', 'web', webConfig),
    "import baseConfig from './vite.config.ts'\n\nexport default {\n  ...baseConfig,\n  build: {\n    ...(baseConfig.build ?? {}),\n    chunkSizeWarningLimit: 1024,\n  },\n}\n",
    'utf8',
  )
  try {
    const webArgs = [
      '--reporter=silent',
      '--filter',
      '@deepseek-ai/dsh-web-frontend',
      'run',
      'build',
      '--',
      '--config',
      webConfig,
    ]
    const web = run('pnpm', webArgs, { quiet: true, check: false, env: harnessEnv })
    if (web.status !== 0) {
      const alt = run(
        'pnpm',
        [
          '--reporter=silent',
          '--filter',
          '@deepseek-ai/dsh-web-frontend',
          'exec',
          'vite',
          'build',
          '--config',
          webConfig,
        ],
        { quiet: true, check: false, env: harnessEnv },
      )
      if (alt.status !== 0) {
        if (web.stdout) process.stdout.write(web.stdout)
        if (web.stderr) process.stderr.write(web.stderr)
        if (alt.stdout) process.stdout.write(alt.stdout)
        if (alt.stderr) process.stderr.write(alt.stderr)
        throw new Error(`build-engine: web build failed (exit ${web.status})`)
      }
    }
  } finally {
    rmSync(join(dest, 'apps', 'web', webConfig), { force: true })
  }
} finally {
  rmSync(pnpmExecBridge, { force: true })
}

const bin = join(dest, 'apps', 'cli', 'lib', 'bin.js')
const html = join(dest, 'apps', 'web', 'dist', 'index.html')
if (!existsSync(bin)) throw new Error(`build-engine: missing ${bin}`)
if (!existsSync(html)) throw new Error(`build-engine: missing ${html}`)
console.log(`OK: engine built at ${dest}`)
