@echo off
REM Install the CapCut activity agent to start automatically at logon for the
REM current user. Visible in Task Scheduler and Task Manager (not hidden).
setlocal
set TASK=CapCutActivityAgent
set EXE=%~dp0capcut_agent.exe

if not exist "%EXE%" (
  echo ERROR: capcut_agent.exe not found next to this script.
  echo Build it first with build.bat, then copy the exe here.
  pause
  exit /b 1
)

schtasks /Create /TN "%TASK%" /TR "\"%EXE%\"" /SC ONLOGON /RL LIMITED /F
if errorlevel 1 (
  echo Failed to create the scheduled task.
  pause
  exit /b 1
)
echo Installed scheduled task "%TASK%" (runs at logon).
echo Starting it now...
schtasks /Run /TN "%TASK%"
echo.
echo Done. The agent is now running and will start automatically at each logon.
pause
