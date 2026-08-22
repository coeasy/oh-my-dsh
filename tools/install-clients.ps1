# Install packed VSIX into Cursor/VS Code. Prints desktop installer paths.
# Usage:
#   .\install-clients.ps1
#   $env:DSH_INSTALL_DESKTOP = '1'; .\install-clients.ps1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Join-Path $PSScriptRoot '..')

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js 22+ is required. Install from https://nodejs.org/'
}

Write-Host '== install packed clients =='
node (Join-Path $PSScriptRoot '..\scripts\install-clients.mjs')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
