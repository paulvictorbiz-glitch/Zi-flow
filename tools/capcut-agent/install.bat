@echo off
setlocal enabledelayedexpansion
REM Self-diagnosing installer for the CapCut activity agent.
REM Never exits silently: prints PASS/FAIL per step + a final summary.
REM Kept in sync with the generated install.bat in src/pages/activity.jsx.
set TASK=CapCutActivityAgent
set EXE=%~dp0capcut_agent.exe
set DIAG=%~dp0capcut_diagnostic.txt
set S_EXE=FAIL
set S_BLOCK=skipped
set S_TEST=FAIL
set S_TASK=FAIL

echo ============================================
echo   CapCut tracker installer
echo ============================================
echo.

REM --- Step 1: is the EXE actually here? ---
echo [1/4] Checking for capcut_agent.exe ...
if not exist "%EXE%" (
  echo     X  capcut_agent.exe is MISSING from this folder.
  echo        Your browser or antivirus most likely blocked or quarantined it.
  echo        - Check your Downloads folder and Windows Security ^> Protection history.
  echo        - Re-download, then right-click the .zip ^> Properties ^> Unblock BEFORE extracting.
  goto :summary
)
set S_EXE=PASS
echo     OK capcut_agent.exe found.
echo.

REM --- Step 2: is the file blocked by SmartScreen (Mark-of-the-Web)? ---
echo [2/4] Checking if Windows has the file blocked (Mark-of-the-Web) ...
more < "%EXE%:Zone.Identifier" >nul 2>&1
if not errorlevel 1 (
  set S_BLOCK=BLOCKED
  echo     !  The file is marked as downloaded from the internet ^(SmartScreen may block it^).
  echo        Attempting to unblock it now ...
  powershell -NoProfile -Command "Unblock-File -Path '%EXE%'" >nul 2>&1
  if errorlevel 1 ( echo     X  Could not auto-unblock. Right-click capcut_agent.exe ^> Properties ^> Unblock. ) else ( set S_BLOCK=UNBLOCKED & echo     OK Unblocked the file. )
) else (
  set S_BLOCK=clean
  echo     OK File is not blocked.
)
echo.

REM --- Step 3: run the agent once in the foreground to capture any AV/run error ---
echo [3/4] Running a one-time self-test ^(this also proves Supabase connectivity^) ...
if exist "%DIAG%" del "%DIAG%" >nul 2>&1
"%EXE%" --once
set RC=%errorlevel%
if exist "%DIAG%" ( echo. & type "%DIAG%" & echo. )
if "%RC%"=="0" (
  set S_TEST=PASS
  echo     OK Self-test passed.
) else (
  echo     X  Self-test did not pass ^(exit code %RC%^).
  echo        If you saw a virus/Defender message above, the EXE was blocked from running.
  echo        Add an exclusion for this folder in Windows Security, or unblock the file, then re-run.
)
echo.

REM --- Step 4: register the scheduled task so it auto-starts at logon ---
echo [4/4] Installing the background task ...
schtasks /Create /TN "%TASK%" /TR "\"%EXE%\"" /SC ONLOGON /RL LIMITED /F >nul 2>&1
if errorlevel 1 (
  echo     X  Could not create the scheduled task ^(permissions or policy^).
) else (
  set S_TASK=PASS
  schtasks /Run /TN "%TASK%" >nul 2>&1
  echo     OK Task installed and started. It will auto-start at every logon.
)
echo.

:summary
echo ============================================
echo   SUMMARY  ^(screenshot this for Paul^)
echo ============================================
echo   EXE present        : %S_EXE%
echo   SmartScreen block  : %S_BLOCK%
echo   Connectivity test  : %S_TEST%
echo   Background task    : %S_TASK%
echo ============================================
echo.
pause
