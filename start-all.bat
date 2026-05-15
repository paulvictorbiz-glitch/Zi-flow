@echo off
REM ──────────────────────────────────────────────────────────────────────────
REM  Start Footage Brain (prod) + Ziflow (dev) in one click.
REM  - Footage Brain prod  → http://localhost:8765
REM  - Ziflow dev (Vite)   → http://localhost:8000
REM ──────────────────────────────────────────────────────────────────────────

setlocal

set "ZIFLOW_DIR=%~dp0"
set "FB_DIR=C:\Users\Mi\Downloads\files\footage-brain\footage-brain-test"

REM Strip trailing backslash from ZIFLOW_DIR for cleaner echo
if "%ZIFLOW_DIR:~-1%"=="\" set "ZIFLOW_DIR=%ZIFLOW_DIR:~0,-1%"

echo.
echo === Launching Footage Brain (prod) + Ziflow (dev) ===
echo   Footage Brain : %FB_DIR%
echo   Ziflow        : %ZIFLOW_DIR%
echo.

if not exist "%FB_DIR%\start-prod.bat" (
    echo [ERROR] Could not find Footage Brain at:
    echo         %FB_DIR%\start-prod.bat
    pause & exit /b 1
)

if not exist "%ZIFLOW_DIR%\package.json" (
    echo [ERROR] Could not find Ziflow package.json at:
    echo         %ZIFLOW_DIR%\package.json
    pause & exit /b 1
)

REM ── Step 1: Launch Footage Brain prod in its own window ────────────────────
echo [1/2] Starting Footage Brain (prod) ...
start "Footage Brain (prod)" cmd /k "cd /d "%FB_DIR%" && call start-prod.bat"

REM Give Footage Brain a head start so its port is up before Ziflow proxies to it
timeout /t 5 /nobreak >nul

REM ── Step 2: Launch Ziflow dev server in its own window ─────────────────────
echo [2/2] Starting Ziflow (npm run dev) ...
start "Ziflow (dev)" cmd /k "cd /d "%ZIFLOW_DIR%" && npm run dev"

REM Open browser tabs for both
timeout /t 4 /nobreak >nul
start "" "http://localhost:8765"
start "" "http://localhost:8000"

echo.
echo [OK] Both launched. Close each window with Ctrl+C when done.
echo.
endlocal
