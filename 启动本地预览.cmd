@echo off
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel%==0 (
  node scripts/build.cjs
  start "" "http://127.0.0.1:4173/"
  node scripts/serve.cjs
) else (
  if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" (
    "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts/build.cjs
    start "" "http://127.0.0.1:4173/"
    "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" scripts/serve.cjs
  ) else (
    echo Please install Node.js 20 or newer from https://nodejs.org/
    pause
  )
)
