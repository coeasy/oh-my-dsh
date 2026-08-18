/** Windows `spawn(..., { shell: true })` splits on spaces unless args are quoted. */

export function quoteWinArg(arg: string): string {
  if (arg.length === 0) return '""'
  if (!/[\s"]/u.test(arg)) return arg
  return `"${arg.replace(/"/g, '\\"')}"`
}

export function spawnArgv(args: string[], platform = process.platform): string[] {
  if (platform !== 'win32') return args
  return args.map(quoteWinArg)
}

/** PATH `dsh` on Windows is almost always `dsh.cmd` from npm. */
export function normalizeDshCommand(command: string, platform = process.platform): string {
  if (platform !== 'win32') return command
  if (/\.(cmd|exe|bat)$/i.test(command)) return command
  if (/(^|[\\/])dsh$/i.test(command)) return `${command}.cmd`
  return command
}

export function buildWebArgs(patchPath: string, extraArgs: string[] = []): string[] {
  return ['web', '--patch', patchPath, '--host', '127.0.0.1', '--port', '0', ...extraArgs]
}
