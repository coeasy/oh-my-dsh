/**
 * Stub `dsh` engine for the desktop E2E (B3).
 *
 * The real DeepSeek Harness requires a git clone + database + network, none of
 * which belongs in CI. This stub plays the engine's ready-file contract so the
 * client's launch → navigation → quit → recovery loop can be exercised for
 * real against the compiled Electron app:
 *
 *   - When `DSH_READY_FILE` is set, it opens a loopback HTTP server, writes the
 *     ready JSON `{ url, port }`, then serves a minimal page and stays alive
 *     until it receives a terminate signal (so the client's process-tree reap
 *     can be asserted).
 *   - When `DSH_READY_FILE` is absent (marketplace / plugin provisioning calls
 *     re-invoke the engine binary), it exits 0 immediately so those background
 *     best-effort steps no-op instead of hanging.
 *
 * Spawned via a generated `.cmd`/sh wrapper pointing `node` at this file.
 */
import { createServer } from 'node:http'
import { writeFileSync, rmSync } from 'node:fs'

const PORT = 0 // OS-assigned loopback port

function serveHtml(res) {
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(
    `<!doctype html><html><head><meta charset="utf-8"><title>dsh-stub</title></head>
     <body><h1 id="stub">stub-engine-ready</h1></body></html>`,
  )
}

const readyFile = process.env.DSH_READY_FILE
if (!readyFile) {
  // Background engine re-invocation (marketplace/plugin ops): no-op fast.
  process.exit(0)
}

const server = createServer((req, res) => serveHtml(res))
server.listen(PORT, '127.0.0.1', () => {
  const address = server.address()
  if (address === null || typeof address === 'object' && address === undefined) {
    process.exit(3)
  }
  const port = typeof address === 'object' && address !== null ? address.port : 0
  const url = `http://127.0.0.1:${port}/`
  writeFileSync(readyFile, JSON.stringify({ url, port }), 'utf8')
})

server.on('error', (error) => {
  process.stderr.write(`[dsh-stub] server error: ${error.message}\n`)
  process.exit(4)
})

function shutdown() {
  try {
    rmSync(readyFile, { force: true })
  } catch {
    // best-effort
  }
  server.close(() => process.exit(0))
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)