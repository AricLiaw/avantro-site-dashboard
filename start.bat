@echo off
rem Avantro Project dashboard - Windows launcher. Double-click to start.
cd /d "%~dp0"
set "NODE="
where node >nul 2>nul && set "NODE=node"
if not defined NODE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" set "NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not defined NODE (
  echo Node.js 22.5 or newer is required but was not found.
  echo Install it from https://nodejs.org  ^(LTS^)  or run:  winget install OpenJS.NodeJS.LTS
  pause
  exit /b 1
)
"%NODE%" server\index.js
pause
