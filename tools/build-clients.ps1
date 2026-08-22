# One-click: resolve the newest DeepSeek Harness for the channel, fetch it,
# build the engine, and pack clients for this OS. All logic lives in
# scripts/build-clients.mjs so every platform wrapper stays identical.
#
# Usage:
#   .\build-clients.ps1
#   .\build-clients.ps1 stable|latest|lock|<ref>
#
# Env knobs (see scripts/build-clients.mjs):
#   DSH_CLIENTS=vscode,nsis,zip
#   DSH_SKIP_ENGINE_BUILD=1  DSH_SKIP_FETCH=1  DSH_SKIP_PNPM_INSTALL=1
#   DSH_AUTO_UPDATE_LOCK=1   DSH_INSTALL=1
param(
  [string]$Channel = 'stable'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Join-Path $PSScriptRoot '..')
$env:CI = '1'

function Assert-Command([string]$Name, [string]$Hint) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name is required. $Hint"
  }
}

function Pause-IfInteractive {
  if (-not $env:GITHUB_ACTIONS) {
    Read-Host 'Press Enter to close'
  }
}

try {
  Assert-Command 'node' 'Install Node.js 22+ from https://nodejs.org/'
  Assert-Command 'pnpm' 'Run: npm install -g pnpm@10'
  Assert-Command 'git' 'Install git from https://git-scm.com/'

  node (Join-Path $PSScriptRoot '..\scripts\build-clients.mjs') $Channel
  if ($LASTEXITCODE -ne 0) { throw "client build failed (exit $LASTEXITCODE)" }

  Write-Host ''
  Write-Host 'Artifacts:'
  Write-Host '  apps\vscode\*.vsix'
  Write-Host '  apps\desktop\dist-release\'
  Write-Host 'Next: .\install-clients.ps1'
} catch {
  Write-Error $_
  Pause-IfInteractive
  exit 1
}
