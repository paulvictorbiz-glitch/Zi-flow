/* =========================================================
   Shared CapCut tracker download helper.

   Single source of truth for the "Download CapCut tracker" zip used by BOTH
   the My Work page and the Activity page. Previously each page generated its
   own install.bat (the My Work one was a stale, bare version that gave a
   dead-end "capcut_agent.exe not found" message), so they drifted.

   The agent is now a PowerShell script (capcut_agent.ps1) launched hidden via
   run-hidden.vbs — NOT a PyInstaller .exe — so there is no unsigned binary for
   antivirus to quarantine (the root cause of the old "missing exe" failures).

   The zip contains:
     - capcut_config.json   (per-user: bakes in the WORKER id)
     - install.bat          (self-diagnosing 4-step installer, generated here)
     - capcut_agent.ps1      (the agent — fetched from /capcut-agent/)
     - run-hidden.vbs        (hidden launcher — fetched from /capcut-agent/)
   ========================================================= */
import JSZip from "jszip";
import { supabase } from "./supabase-client.js";

// A stable, unique id per download/install. Makes every heartbeat traceable to
// one specific install (not just a worker) and ties the download-event log row
// to the later selftest/agent_start rows the agent writes.
function newInstallId() {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* fall through */ }
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

// Best-effort audit row — records that this user attempted a download. Never
// throws / blocks the download (a missing table just means it isn't logged).
async function logDownloadEvent(worker, installId) {
  try {
    await supabase.from("capcut_install_events").insert({
      worker,
      install_id: installId,
      event: "download",
      client: (typeof navigator !== "undefined" ? navigator.userAgent : "").slice(0, 300),
    });
  } catch { /* table missing / offline — best effort only */ }
}

// Self-diagnosing installer: never exits silently, prints PASS/FAIL per step and
// a final summary the user can screenshot. Adapted for the PowerShell agent.
function buildInstallBat() {
  return [
    "@echo off",
    "setlocal enabledelayedexpansion",
    "REM CapCut activity tracker - one-time install + self-test.",
    "REM Run from the folder you unzipped into (double-click this file).",
    "set TASK=CapCutActivityAgent",
    "set PS=%~dp0capcut_agent.ps1",
    "set VBS=%~dp0run-hidden.vbs",
    "set DIAG=%~dp0capcut_diagnostic.txt",
    "set S_FILES=FAIL",
    "set S_BLOCK=skipped",
    "set S_TEST=FAIL",
    "set S_TASK=FAIL",
    "",
    "echo ============================================",
    "echo   CapCut tracker installer",
    "echo ============================================",
    "echo.",
    "",
    "REM --- Step 1: are the agent files actually here? ---",
    "echo [1/4] Checking for the tracker files ...",
    "if exist \"%PS%\" goto :have_ps",
    "echo     X  capcut_agent.ps1 is MISSING from this folder.",
    "echo \"%~dp0\" | findstr /I /C:\"\\Temp\\\" >nul",
    "if not errorlevel 1 (",
    "  echo        It looks like you launched install.bat from INSIDE the .zip.",
    "  echo        Right-click the .zip ^> Extract All, then run install.bat from the extracted folder.",
    ") else (",
    "  echo        Your browser or antivirus may have removed it.",
    "  echo        - Re-download, then right-click the .zip ^> Properties ^> Unblock BEFORE extracting.",
    ")",
    "goto :summary",
    ":have_ps",
    "if exist \"%VBS%\" goto :have_files",
    "echo     X  run-hidden.vbs is MISSING from this folder. Re-extract the full .zip.",
    "goto :summary",
    ":have_files",
    "set S_FILES=PASS",
    "echo     OK Tracker files found.",
    "echo.",
    "",
    "REM --- Step 2: clear the downloaded-from-internet mark (Mark-of-the-Web) ---",
    "echo [2/4] Unblocking the files (Mark-of-the-Web) ...",
    "powershell -NoProfile -Command \"Unblock-File -Path '%PS%'; Unblock-File -Path '%VBS%'\" >nul 2>&1",
    "if errorlevel 1 ( set S_BLOCK=warn & echo     !  Could not auto-unblock ^(usually harmless^). ) else ( set S_BLOCK=done & echo     OK Files unblocked. )",
    "echo.",
    "",
    "REM --- Step 3: run the agent once to capture any error + prove connectivity ---",
    "echo [3/4] Running a one-time self-test ^(this also proves Supabase connectivity^) ...",
    "if exist \"%DIAG%\" del \"%DIAG%\" >nul 2>&1",
    "powershell -NoProfile -ExecutionPolicy Bypass -File \"%PS%\" --once",
    "set RC=%errorlevel%",
    "if exist \"%DIAG%\" ( echo. & type \"%DIAG%\" & echo. )",
    "if \"%RC%\"==\"0\" (",
    "  set S_TEST=PASS",
    "  echo     OK Self-test passed.",
    ") else (",
    "  echo     X  Self-test did not pass ^(exit code %RC%^).",
    "  echo        Check capcut_agent.log next to this file for the error detail.",
    ")",
    "echo.",
    "",
    "REM --- Step 4: register the scheduled task so it auto-starts (hidden) at logon ---",
    "echo [4/4] Installing the background task ...",
    "schtasks /Create /TN \"%TASK%\" /TR \"wscript.exe \\\"%VBS%\\\"\" /SC ONLOGON /RL LIMITED /F >nul 2>&1",
    "if errorlevel 1 (",
    "  echo     X  Could not create the scheduled task ^(permissions or policy^).",
    ") else (",
    "  set S_TASK=PASS",
    "  schtasks /Run /TN \"%TASK%\" >nul 2>&1",
    "  echo     OK Task installed and started. It will auto-start ^(hidden^) at every logon.",
    ")",
    "echo.",
    "",
    ":summary",
    "echo ============================================",
    "echo   SUMMARY  ^(screenshot this for Paul^)",
    "echo ============================================",
    "echo   Tracker files     : %S_FILES%",
    "echo   Unblock files     : %S_BLOCK%",
    "echo   Connectivity test : %S_TEST%",
    "echo   Background task   : %S_TASK%",
    "echo ============================================",
    "echo.",
    "pause",
  ].join("\r\n");
}

// Fetch a text asset from /capcut-agent/ and validate it actually arrived (a bad
// deploy / SPA-fallback would return tiny or HTML content) before zipping it, so
// the user never gets a silently-empty file.
async function fetchAgentAsset(name) {
  const resp = await fetch(`/capcut-agent/${name}`);
  if (!resp.ok) throw new Error(`${name}: HTTP ${resp.status}`);
  const text = await resp.text();
  if (!text || text.length < 64 || /<!doctype html|<html/i.test(text)) {
    throw new Error(`${name}: unexpected/empty content (got ${text.length} bytes) — is it deployed under /capcut-agent/?`);
  }
  return text;
}

/**
 * Build and trigger the per-user CapCut tracker zip download.
 * @param {string} personId  the editor's worker id (baked into capcut_config.json)
 */
export async function downloadCapcutTracker(personId) {
  const zip = new JSZip();
  const installId = newInstallId();

  // Record the download attempt up-front (before fetching assets), so even a
  // failed download is visible to the owner as an attempt.
  logDownloadEvent(personId, installId);

  // Per-user config — bakes the worker id + this install's unique id in.
  zip.file("capcut_config.json", JSON.stringify({ WORKER: personId, INSTALL_ID: installId, POLL_SECONDS: 15 }, null, 2));
  zip.file("install.bat", buildInstallBat());

  // Fetch the shared agent + hidden launcher (validated).
  try {
    const [ps1, vbs] = await Promise.all([
      fetchAgentAsset("capcut_agent.ps1"),
      fetchAgentAsset("run-hidden.vbs"),
    ]);
    zip.file("capcut_agent.ps1", ps1);
    zip.file("run-hidden.vbs", vbs);
  } catch (e) {
    alert("Could not fetch the tracker files — check that they're deployed under /capcut-agent/.\n\n" + e.message);
    return;
  }

  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `CapCutTracker-${personId}.zip`; a.click();
  URL.revokeObjectURL(url);
}
