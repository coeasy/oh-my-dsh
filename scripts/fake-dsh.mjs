/**
 * Stand-in for `dsh web` so client-runtime can integration-test spawn,
 * ready-file polling, loopback checks, and the shutdown ladder without
 * a real DeepSeek Harness install.
 *
 * Honors DSH_READY_FILE / DSH_WORKSPACE_CWD. Exits on stdin EOF or SIGTERM.
 */
import { writeFileSync } from 'node:fs'

if (process.argv.includes('--version') || process.argv[2] === '--version') {
  process.stdout.write('fake-dsh 0.1.0\n')
  process.exit(0)
}

const readyPath = process.env.DSH_READY_FILE
if (!readyPath) {
  process.stderr.write('fake-dsh: DSH_READY_FILE is required\n')
  process.exit(1)
}

const port = 41_234
const payload = {
  url: `http://127.0.0.1:${port}`,
  host: '127.0.0.1',
  port,
  pid: process.pid,
  workspaceCwd: process.env.DSH_WORKSPACE_CWD,
}
writeFileSync(readyPath, `${JSON.stringify(payload)}\n`, 'utf8')
process.stdout.write(`dsh web: http://127.0.0.1:${port}\n`)

const exit = () => process.exit(0)
process.stdin.resume()
process.stdin.on('end', exit)
process.on('SIGTERM', exit)
process.on('SIGINT', exit)
