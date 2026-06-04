@echo off
REM Stop and remove the CapCut activity agent's scheduled task.
set TASK=CapCutActivityAgent
schtasks /End /TN "%TASK%" 2>nul
schtasks /Delete /TN "%TASK%" /F
echo Removed scheduled task "%TASK%". (Stop the running process via Task Manager if still open.)
pause
