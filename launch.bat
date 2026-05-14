@echo off
REM Workflow dashboard — local dev launcher.
REM Starts the Vite dev server on :8000 and opens the browser tab.

cd /d "%~dp0"

if not exist node_modules (
  echo Installing dependencies for the first time...
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install failed. Fix the error above and try again.
    pause
    exit /b 1
  )
)

REM Open the browser after a brief delay so Vite has time to bind the port.
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:8000/"

echo.
echo Starting dev server at http://localhost:8000/
echo Press Ctrl+C in this window to stop.
echo.

npm run dev
