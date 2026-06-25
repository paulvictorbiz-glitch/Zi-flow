' Launches the CapCut tracker agent with NO visible window.
' The scheduled task (CapCutActivityAgent) runs this at logon. Using a VBS shim
' with window style 0 avoids the brief console flash that "powershell -WindowStyle
' Hidden" still produces. Self-locating: runs capcut_agent.ps1 from its own folder.
Dim fso, sh, scriptDir
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & scriptDir & "\capcut_agent.ps1""", 0, False
