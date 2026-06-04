@echo off
REM Build capcut_agent.exe (run on a Windows machine with Python installed).
REM The --trusted-host flags avoid a TLS-interception (e.g. Avast) failure some
REM machines hit when pip verifies PyPI's certificate.
echo Installing build deps...
python -m pip install --quiet --trusted-host pypi.org --trusted-host files.pythonhosted.org pywin32 psutil pyinstaller
echo Building capcut_agent.exe...
python -m PyInstaller --onefile --noconsole --name capcut_agent capcut_agent.py
echo.
echo Done. The exe is in the "dist" folder: dist\capcut_agent.exe
echo Copy dist\capcut_agent.exe + capcut_config.json + install.bat to the target PC.
pause
