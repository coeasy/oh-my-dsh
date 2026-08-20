@echo off
setlocal EnableExtensions
cd /d "%~dp0.."

rem Install packed VSIX into Cursor/VS Code. Prints desktop installer paths.
rem Usage:
rem   install-clients.cmd
rem   set DSH_INSTALL_DESKTOP=1 && install-clients.cmd

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js 22+ is required. https://nodejs.org/
  exit /b 1
)

echo == install packed clients ==
call node scripts\install-clients.mjs
exit /b %ERRORLEVEL%
