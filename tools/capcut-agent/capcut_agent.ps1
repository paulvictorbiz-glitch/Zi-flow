# CapCut activity agent (PowerShell edition).
#
# Heartbeats one editor's CapCut usage to Supabase. It records only:
#   - whether CapCut.exe is running
#   - whether CapCut is the focused (foreground) window  -> active vs idle
#   - the open CapCut project name (read from disk)
#   - the machine name
#
# It is transparent and CapCut-only: it does NOT read other applications,
# capture keystrokes, or take screenshots. It runs quietly in the background
# (launched hidden via run-hidden.vbs) and writes a small local log next to itself.
#
# This replaces the old PyInstaller capcut_agent.exe: PowerShell ships with
# Windows and is Microsoft-signed, so there is no unsigned binary for antivirus
# to quarantine. PowerShell also uses the Windows trust store (SChannel) natively,
# so it works behind corporate/antivirus HTTPS interception with no extra deps.
#
# Config lives below and can be overridden by a capcut_config.json next to this file.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File capcut_agent.ps1            # background loop
#   powershell -NoProfile -ExecutionPolicy Bypass -File capcut_agent.ps1 --once     # one-shot self-test

$ErrorActionPreference = "Stop"

# Prefer TLS 1.2 (older PowerShell 5.1 defaults can be lower).
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}

# Foreground-window lookup via user32 (P/Invoke).
try {
  Add-Type -ErrorAction Stop @"
using System;
using System.Runtime.InteropServices;
public class FgWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
} catch {}

$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }

# --- Config (override per-machine via capcut_config.json next to this file) ---
$cfg = @{
  WORKER             = "sam"   # editor id this machine belongs to (Jay = "sam")
  INSTALL_ID         = ""       # unique per-download id (baked into config) — makes each heartbeat traceable to one install
  SUPABASE_URL       = "https://kjruhbaahqkuajseoojn.supabase.co"
  ANON_KEY           = "sb_publishable_dwqdtQk9W7xNHgHn2kJbkA_2DNMz6uK"
  POLL_SECONDS       = 15       # sample every 15s for near-real-time tracking
  CAPCUT_PROCESS     = "CapCut.exe"
  # CapCut's window title is just "CapCut" (no project name), so the open project
  # is read from disk: each project is a folder here, and the most recently
  # modified one is the project being edited.
  DRAFT_DIR          = "$env:LOCALAPPDATA\CapCut\User Data\Projects\com.lveditor.draft"
  PROJECT_RECENT_MIN = 20       # report the open project if its draft changed within 20 min
}

function Write-Log($msg) {
  try {
    $line = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss") + "  " + $msg
    Add-Content -LiteralPath (Join-Path $ScriptDir "capcut_agent.log") -Value $line -Encoding UTF8
  } catch {}
}

function Load-Config {
  $path = Join-Path $ScriptDir "capcut_config.json"
  if (Test-Path -LiteralPath $path) {
    try {
      $j = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
      foreach ($p in $j.PSObject.Properties) { $cfg[$p.Name] = $p.Value }
    } catch { Write-Log "config read error: $($_.Exception.Message)" }
  }
  # Env override — lets one machine run as a different worker without editing
  # the shared config (e.g. the owner tracking their own CapCut as "paul").
  if ($env:CAPCUT_WORKER) { $cfg.WORKER = $env:CAPCUT_WORKER.Trim() }
}

function Get-CapcutPids {
  # PIDs of every running CapCut process. Get-Process matches the base name.
  $name = ($cfg.CAPCUT_PROCESS -replace '\.exe$', '')
  return @(Get-Process -Name $name -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
}

function Get-ForegroundPid {
  try {
    $h = [FgWin]::GetForegroundWindow()
    if ($h -eq [IntPtr]::Zero) { return -1 }
    $p = [uint32]0
    [void][FgWin]::GetWindowThreadProcessId($h, [ref]$p)
    return [int]$p
  } catch { return -1 }
}

function Get-ActiveProject {
  # The project currently being edited = the project folder whose draft was
  # modified most recently (CapCut autosaves while you edit). Returns the folder
  # name (= project name), or $null if nothing changed recently.
  $draftDir = [System.Environment]::ExpandEnvironmentVariables([string]$cfg.DRAFT_DIR)
  if (-not $draftDir -or -not (Test-Path -LiteralPath $draftDir)) { return $null }
  $newestName = $null
  $newestM = [datetime]::MinValue
  try {
    foreach ($d in (Get-ChildItem -LiteralPath $draftDir -Directory -ErrorAction SilentlyContinue)) {
      # Real projects are folders containing draft_meta_info.json. This skips
      # system folders like ".recycle_bin" and dotfolders.
      if ($d.Name.StartsWith(".")) { continue }
      $meta = Join-Path $d.FullName "draft_meta_info.json"
      if (-not (Test-Path -LiteralPath $meta)) { continue }
      $m = (Get-Item -LiteralPath $meta).LastWriteTime
      if ($m -gt $newestM) { $newestM = $m; $newestName = $d.Name }
    }
  } catch { return $null }
  $recentMin = [int]$cfg.PROJECT_RECENT_MIN
  if ($newestName -and ((Get-Date) - $newestM).TotalMinutes -le $recentMin) {
    return $newestName.Substring(0, [Math]::Min(200, $newestName.Length))
  }
  return $null
}

function Send-Heartbeat($running, $focused, $projectTitle) {
  # POST one heartbeat. Returns a hashtable @{ ok; detail } so callers and the
  # self-test can report the exact HTTP status or network error.
  $payload = @{
    worker        = $cfg.WORKER
    install_id    = $cfg.INSTALL_ID
    running       = [bool]$running
    focused       = [bool]$focused
    project_title = $projectTitle
    machine       = [System.Net.Dns]::GetHostName()
  }
  $json = $payload | ConvertTo-Json -Compress
  $headers = @{
    apikey        = $cfg.ANON_KEY
    Authorization = "Bearer " + $cfg.ANON_KEY
    Prefer        = "return=minimal"
  }
  $uri = ([string]$cfg.SUPABASE_URL).TrimEnd("/") + "/rest/v1/capcut_activity"
  try {
    Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -ContentType "application/json" -Body $json -TimeoutSec 20 | Out-Null
    return @{ ok = $true; detail = "HTTP 2xx (row accepted)" }
  } catch {
    $code = ""
    try { if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode } } catch {}
    $detail = if ($code) { "HTTP $code`: $($_.Exception.Message)" } else { "send error: $($_.Exception.Message)" }
    Write-Log $detail
    return @{ ok = $false; detail = $detail }
  }
}

function Send-Event($event, $ok, $detail) {
  # Best-effort lifecycle audit row (download/run telemetry the owner sees on the
  # Monitor hub "CapCut Tracker Installs" card). NEVER affects the agent — any
  # failure (e.g. table not yet created) is swallowed and only logged locally.
  $payload = @{
    worker     = $cfg.WORKER
    install_id = $cfg.INSTALL_ID
    event      = $event
    machine    = [System.Net.Dns]::GetHostName()
    os         = [System.Environment]::OSVersion.VersionString
  }
  if ($null -ne $ok) { $payload.ok = [bool]$ok }
  if ($detail) { $payload.detail = "$detail" }
  $json = $payload | ConvertTo-Json -Compress
  $headers = @{ apikey = $cfg.ANON_KEY; Authorization = "Bearer " + $cfg.ANON_KEY; Prefer = "return=minimal" }
  $uri = ([string]$cfg.SUPABASE_URL).TrimEnd("/") + "/rest/v1/capcut_install_events"
  try {
    Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -ContentType "application/json" -Body $json -TimeoutSec 20 | Out-Null
  } catch {
    Write-Log ("event '$event' not logged: " + $_.Exception.Message)
  }
}

function Invoke-Diagnose {
  # One-shot self-test, for install.bat to call. Prints a config summary, whether
  # CapCut is running, and the live heartbeat status, writes capcut_diagnostic.txt
  # next to this script (which install.bat reads back), and exits non-zero if the
  # heartbeat could not be sent. Proves end-to-end connectivity.
  $lines = New-Object System.Collections.ArrayList
  function Emit($s) { [void]$lines.Add($s); try { Write-Host $s } catch {} }

  Emit "=== CapCut tracker diagnostic ==="
  Emit ("  worker   : " + $cfg.WORKER)
  Emit ("  machine  : " + [System.Net.Dns]::GetHostName())
  Emit ("  supabase : " + $cfg.SUPABASE_URL)

  $running = $false
  try { $running = (Get-CapcutPids).Count -gt 0 } catch { Emit ("  process check FAILED: " + $_.Exception.Message) }
  Emit ("  CapCut running: " + $(if ($running) { "yes" } else { "no (that is OK for this test)" }))

  $focused = $false
  $project = $null
  if ($running) {
    $pids = Get-CapcutPids
    $focused = $pids -contains (Get-ForegroundPid)
    $project = Get-ActiveProject
  }

  # Always send one heartbeat so we can confirm Supabase connectivity even when
  # CapCut is closed during the test.
  $res = Send-Heartbeat $running $focused $project
  Emit ("  heartbeat: " + $res.detail)
  if ($res.ok) { Emit "RESULT: PASS - a test row reached Supabase. The tracker can report data." }
  else { Emit "RESULT: FAIL - could not reach Supabase. See the detail above and capcut_agent.log." }

  # Record the install/run attempt so the owner sees it on the Monitor hub.
  Send-Event "selftest" $res.ok $res.detail

  try { Set-Content -LiteralPath (Join-Path $ScriptDir "capcut_diagnostic.txt") -Value ($lines -join "`r`n") -Encoding UTF8 } catch {}
  if ($res.ok) { return 0 } else { return 1 }
}

# --- Entry point ---
Load-Config

if (($args -contains "--once") -or ($args -contains "--diagnose")) {
  exit (Invoke-Diagnose)
}

Write-Log ("agent start - worker=" + $cfg.WORKER + " machine=" + [System.Net.Dns]::GetHostName() + " poll=" + $cfg.POLL_SECONDS + "s")
Send-Event "agent_start" $null ("poll=" + $cfg.POLL_SECONDS + "s")
while ($true) {
  try {
    $pids = Get-CapcutPids
    # Only heartbeat while CapCut is actually open. Closed time is inferred from
    # the absence of recent heartbeats — this keeps the row count to real
    # CapCut-usage minutes instead of logging idle machine time 24/7.
    if ($pids.Count -gt 0) {
      $focused = $pids -contains (Get-ForegroundPid)
      $project = Get-ActiveProject
      Send-Heartbeat $true $focused $project | Out-Null
    }
  } catch { Write-Log ("loop error: " + $_.Exception.Message) }
  $sleep = [Math]::Max(15, [int]$cfg.POLL_SECONDS)
  Start-Sleep -Seconds $sleep
}
