@echo off
setlocal EnableExtensions
cd /d "%~dp0.."
set "CI=1"

rem One-click: resolve the newest DeepSeek Harness for the channel, fetch it,
rem build the engine, and pack clients for this OS. All logic lives in
rem scripts\build-clients.mjs so every platform wrapper stays identical.
rem
rem Usage:
rem   build-clients.cmd
rem   build-clients.cmd stable|latest|lock|<ref>
rem
rem Env knobs (see scripts\build-clients.mjs):
rem   DSH_CLIENTS=vscode,nsis,zip
rem   DSH_SKIP_ENGINE_BUILD=1  DSH_SKIP_FETCH=1  DSH_SKIP_PNPM_INSTALL=1
rem   DSH_AUTO_UPDATE_LOCK=1   DSH_INSTALL=1

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
where git >nul 2>&1
if errorlevel 1 (
  echo ERROR: git is required. https://git-scm.com/
  if not defined GITHUB_ACTIONS pause
  exit /b 1
)

set "CHANNEL=%~1"
if "%CHANNEL%"=="" set "CHANNEL=stable"

call node scripts\build-clients.mjs %CHANNEL%
if errorlevel 1 (
  echo ERROR: client build failed
  if not defined GITHUB_ACTIONS pause
  exit /b 1
)

echo.
echo Artifacts:
echo   apps\vscode\*.vsix
echo   apps\desktop\dist-release\
echo Next: tools\install-clients.cmd
exit /b 0
