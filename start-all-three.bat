@echo off
REM ──────────────────────────────────────────────────────────────────────────
REM  Start All Three: Content Desk + Footage Brain (prod) + Ziflow (dev)
REM  - Content Desk     -> http://localhost:3000
REM  - Footage Brain    -> http://localhost:8765
REM  - Ziflow dev       -> http://localhost:8000
REM
REM  Each server runs in its own window. This script waits for servers to
REM  accept connections before opening browser tabs, so you never land on
REM  a "can't connect" page.
REM ──────────────────────────────────────────────────────────────────────────

setlocal EnableDelayedExpansion

set "ZIFLOW_DIR=%~dp0"
set "FB_DIR=C:\Users\Mi\Downloads\files\footage-brain\footage-brain-test"
set "CD_DIR=C:\Users\Mi\nikky-content-desk"

REM Strip trailing backslash from ZIFLOW_DIR for cleaner echo
if "%ZIFLOW_DIR:~-1%"=="\" set "ZIFLOW_DIR=%ZIFLOW_DIR:~0,-1%"

echo.
echo === Launching All Three Apps ===
echo   Content Desk      : %CD_DIR%
echo   Footage Brain     : %FB_DIR%
echo   Ziflow            : %ZIFLOW_DIR%
echo.

REM ── Step 1: Launch Content Desk ────────────────────────────────────────────
echo [1/3] Starting Content Desk (port 3000) ...
start "Content Desk" cmd /k "cd /d "%CD_DIR%" && launch.bat"

REM ── Step 2: Launch Footage Brain prod ──────────────────────────────────────
echo [2/3] Starting Footage Brain (port 8765) ...
start "Footage Brain (prod)" cmd /k "cd /d "%FB_DIR%" && call start-prod.bat"

REM ── Step 3: Launch Ziflow dev ─────────────────────────────────────────────
echo [3/3] Starting Ziflow (port 8000) ...
start "Ziflow (dev)" cmd /k "cd /d "%ZIFLOW_DIR%" && npm run dev"

echo.
echo Waiting for the servers to accept connections before opening browser tabs.
echo (You can close THIS window any time — the three server windows keep running.)
echo.

REM ── Content Desk (:3000) ─────────────────────────────────────────────────────
call :waitport 3000 60 "Content Desk"
if not errorlevel 1 (
    start "" "http://localhost:3000"
)

REM ── Ziflow dev server (:8000) ───────────────────────────────────────────────
call :waitport 8000 60 "Ziflow"

REM ── Footage Brain (:8765) ───────────────────────────────────────────────────
call :waitport 8765 300 "Footage Brain"
if not errorlevel 1 (
    start "" "http://localhost:8765"
)

echo.
echo [OK] All three services launching...
echo      Content Desk:  http://localhost:3000
echo      Ziflow:        http://localhost:8000
echo      Footage Brain: http://localhost:8765
echo.
endlocal
exit /b 0

REM ══════════════════════════════════════════════════════════════════════════
REM  :waitport <port> <max_seconds> <friendly_name>
REM  Polls every 2s for a process LISTENING on the port
REM ══════════════════════════════════════════════════════════════════════════
:waitport
setlocal EnableDelayedExpansion
set "PORT=%~1"
set /a "MAXSECS=%~2"
set "NAME=%~3"
set /a "WAITED=0"
:wp_poll
powershell -NoProfile -Command "try { Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction Stop | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 (
    echo   [up]      %NAME% is listening on port %PORT%
    endlocal & exit /b 0
)
if !WAITED! geq %MAXSECS% (
    echo   [timeout] %NAME% did not answer on port %PORT% after %MAXSECS%s
    endlocal & exit /b 1
)
set /a "WAITED+=2"
powershell -NoProfile -Command "Start-Sleep -Seconds 2" >nul 2>&1
goto wp_poll
