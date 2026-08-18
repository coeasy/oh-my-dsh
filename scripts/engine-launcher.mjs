/** Relocatable dsh launcher snippets for the desktop extraResources runtime/. */

export const RELATIVE_BIN_WIN = 'harness\\apps\\cli\\lib\\bin.js'
export const RELATIVE_BIN_POSIX = 'harness/apps/cli/lib/bin.js'

export function buildWinLauncher(nodeName = 'node.exe') {
  return `@echo off\r\n"%~dp0${nodeName}" "%~dp0${RELATIVE_BIN_WIN}" %*\r\n`
}

export function buildPosixLauncher(nodeName = 'node') {
  return `#!/bin/sh\nDIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)\nexec "$DIR/${nodeName}" "$DIR/${RELATIVE_BIN_POSIX}" "$@"\n`
}

/** True when the POSIX launcher has no drive-absolute engine path. */
export function isRelocatablePosixLauncher(text) {
  const body = String(text || '')
  if (!body.includes('$DIR/')) return false
  if (!body.includes(RELATIVE_BIN_POSIX)) return false
  if (/[A-Za-z]:[\\/]/u.test(body)) return false
  return true
}

/** True when the Windows launcher has no drive-absolute engine path. */
export function isRelocatableWinLauncher(text) {
  const body = String(text || '')
  if (!body.includes('%~dp0')) return false
  if (!body.includes(RELATIVE_BIN_WIN)) return false
  if (/[A-Za-z]:[\\/]/u.test(body)) return false
  return true
}
