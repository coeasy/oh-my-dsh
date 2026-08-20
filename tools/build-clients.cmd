@echo off
setlocal EnableExtensions
cd /d "%~dp0.."

rem One-click: fetch DeepSeek Harness from GitHub and pack all client scenarios.
rem Usage:
rem   build-clients.cmd
rem   build-clients.cmd stable
rem   build-clients.cmd latest
rem   build-clients.cmd lock
rem   build-clients.cmd master

set "CI=1"
set "CHANNEL=%~1"
if "%CHANNEL%"=="" set "CHANNEL=stable"

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

echo == pnpm install ==
call pnpm install
if errorlevel 1 (
  echo ERROR: pnpm install failed
  if not defined GITHUB_ACTIONS pause
  exit /b 1
)

if /I "%CHANNEL%"=="stable" goto :named
if /I "%CHANNEL%"=="latest" goto :named
if /I "%CHANNEL%"=="lock" goto :named

echo == build clients with DSH_ENGINE_REF=%CHANNEL% ==
set "DSH_ENGINE_REF=%CHANNEL%"
call pnpm run build:clients:stable
goto :done

:named
echo == build clients channel=%CHANNEL% ==
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
  echo Next: tools\install-clients.cmd
)
echo Unpackaged desktop: pnpm --dir apps\desktop start
echo uses gitignored deepseek-harness\ when present, not a stale PATH dsh.
exit /b 0
