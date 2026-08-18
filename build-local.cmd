@echo off
setlocal EnableExtensions
cd /d "%~dp0"

rem One-click LOCAL client build with network optimizations baked in.
rem Wraps build-clients.cmd but pre-configures mirrors/registry so it works on
rem networks where GitHub / npmjs are slow. All optimizations can be turned off.
rem
rem Usage:
rem   build-local.cmd                 build lock channel (pinned engine.lock.json)
rem   build-local.cmd stable          build GitHub stable release
rem   build-local.cmd latest          build GitHub latest release (incl. rc)
rem   build-local.cmd master          build a specific branch/tag
rem
rem Optional env overrides (set to 0 to disable, or to a value to override):
rem   DSH_GH_PROXY=1            route git clone of the engine through ghfast.top
rem   DSH_REGISTRY=https://registry.npmmirror.com
rem   DSH_ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
rem   DSH_INSTALL=1             also install the packed VSIX after building

set "CI=1"
set "CHANNEL=%~1"
if "%CHANNEL%"=="" set "CHANNEL=lock"

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js 22+ is required. https://nodejs.org/
  if not defined GITHUB_ACTIONS pause
  exit /b 1
)
where pnpm >nul 2>&1
if errorlevel 1 (
  echo ERROR: pnpm is required. Run: npm install -g pnpm@10
  if not defined GITHUB_ACTIONS pause
  exit /b 1
)

rem --- GitHub clone proxy (speeds up fetching the DeepSeek Harness engine) ---
if /I not "%DSH_GH_PROXY%"=="0" (
  set "GIT_CONFIG_COUNT=1"
  set "GIT_CONFIG_KEY_0=url.https://ghfast.top/https://github.com/.insteadOf"
  set "GIT_CONFIG_VALUE_0=https://github.com/"
  echo == GitHub clone proxy: ghfast.top ^(DSH_GH_PROXY=0 to disable^) ==
)

rem --- npm registry mirror ---
if defined DSH_REGISTRY (
  set "NPM_CONFIG_REGISTRY=%DSH_REGISTRY%"
  set "npm_config_registry=%DSH_REGISTRY%"
  echo == npm registry: %DSH_REGISTRY% ==
) else (
  set "NPM_CONFIG_REGISTRY=https://registry.npmmirror.com"
  set "npm_config_registry=https://registry.npmmirror.com"
  echo == npm registry: https://registry.npmmirror.com ^(DSH_REGISTRY to override^) ==
)

rem --- Electron binary mirror ---
if defined DSH_ELECTRON_MIRROR (
  set "ELECTRON_MIRROR=%DSH_ELECTRON_MIRROR%"
  echo == electron mirror: %DSH_ELECTRON_MIRROR% ==
) else (
  set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
  echo == electron mirror: https://npmmirror.com/mirrors/electron/ ^(DSH_ELECTRON_MIRROR to override^) ==
)

echo == pnpm install ==
call pnpm install
if errorlevel 1 (
  echo ERROR: pnpm install failed
  if not defined GITHUB_ACTIONS pause
  exit /b 1
)

echo == build clients channel=%CHANNEL% ==
if /I "%CHANNEL%"=="stable" goto :named
if /I "%CHANNEL%"=="latest" goto :named
if /I "%CHANNEL%"=="lock" goto :named
set "DSH_ENGINE_REF=%CHANNEL%"
call pnpm run build:clients:stable
goto :done

:named
call pnpm run build:clients:%CHANNEL%

:done
if errorlevel 1 (
  echo ERROR: client build failed
  if not defined GITHUB_ACTIONS pause
  exit /b 1
)
if /I "%DSH_INSTALL%"=="1" (
  echo == install packed clients ==
  call node scripts\install-clients.mjs
  if errorlevel 1 (
    echo ERROR: install-clients failed
    if not defined GITHUB_ACTIONS pause
    exit /b 1
  )
)
echo.
echo Artifacts:
echo   apps\vscode\*.vsix
echo   apps\desktop\dist-release\
if /I not "%DSH_INSTALL%"=="1" (
  echo Next: install-clients.cmd
)
exit /b 0
