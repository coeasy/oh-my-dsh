# One-click: fetch DeepSeek Harness from GitHub and pack all client scenarios.
# Usage:
#   .\build-clients.ps1
#   .\build-clients.ps1 stable
#   .\build-clients.ps1 latest
#   .\build-clients.ps1 lock
#   .\build-clients.ps1 master
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

  Write-Host '== pnpm install =='
  pnpm install
  if ($LASTEXITCODE -ne 0) { throw "pnpm install failed (exit $LASTEXITCODE)" }

  $named = @('stable', 'latest', 'lock')
  if ($named -contains $Channel.ToLowerInvariant()) {
    Write-Host "== build clients channel=$Channel =="
    pnpm run "build:clients:$Channel"
  } else {
    Write-Host "== build clients with DSH_ENGINE_REF=$Channel =="
    $env:DSH_ENGINE_REF = $Channel
    pnpm run build:clients:stable
  }
  if ($LASTEXITCODE -ne 0) { throw "client build failed (exit $LASTEXITCODE)" }

  if ($env:DSH_INSTALL -eq '1') {
    Write-Host '== install packed clients =='
    node scripts\install-clients.mjs
    if ($LASTEXITCODE -ne 0) { throw "install-clients failed (exit $LASTEXITCODE)" }
  }

  Write-Host ''
  Write-Host 'Artifacts:'
  Write-Host '  apps\vscode\*.vsix'
  Write-Host '  apps\desktop\dist-release\'
  if ($env:DSH_INSTALL -ne '1') {
    Write-Host 'Next: .\install-clients.ps1'
  }
} catch {
  Write-Error $_
  Pause-IfInteractive
  exit 1
}
