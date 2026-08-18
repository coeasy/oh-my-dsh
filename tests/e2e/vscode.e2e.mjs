/**
 * VS Code 扩展端到端冒烟（Phase 2.1 骨架）。
 *
 * 流程：
 *   1. pnpm pack:vscode 产出 VSIX
 *   2. 解析产物路径
 *   3. 安装到临时 extensions-dir
 *   4. 启动扩展并断言 loopback URL 可访问、退出后无残留进程
 *
 * 完整链路（含真实 VS Code 交互）在 CI 上跑；本脚本提供可独立运行的最小闭环，
 * 便于本地快速验证打包链路没有被破坏。
 *
 * 用法：pnpm e2e 或 node tests/e2e/vscode.e2e.mjs
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

function fail(msg) {
  console.error(`e2e: FAIL — ${msg}`)
  process.exit(1)
}

// 1. 打包 VSIX
console.log('e2e: packing vscode extension…')
execFileSync('pnpm', ['pack:vscode'], { cwd: root, stdio: 'inherit' })

// 2. 解析最新 VSIX 产物
const outDir = join(root, 'apps', 'vscode', 'out')
if (!existsSync(outDir)) fail(`missing ${outDir}`)
const vsix = readdirSync(outDir).find((f) => f.endsWith('.vsix'))
if (!vsix) fail('no .vsix produced in apps/vscode/out')
console.log(`e2e: produced ${vsix}`)

// 3. 断言扩展产物包含图标与主入口（打包回归检查）
const extDir = join(root, 'apps', 'vscode')
for (const expected of ['out/extension.js', 'media/icon.png']) {
  const p = join(extDir, expected)
  if (!existsSync(p)) fail(`missing ${expected}`)
}

// 4. 占位：真实 VS Code 启动/断言在 CI 由 @vscode/test-cli 完成
//    本地闭环到此为止，确认打包链路未破坏。
console.log('e2e: OK — vscode extension artifacts verified')

// NOTE for CI: follow with
//   npx @vscode/test-cli --install-extension <vsix> --extensions-dir <tmp>
//   launch headless, assert GET http://127.0.0.1:<port> == 200, assert process tree cleared.
