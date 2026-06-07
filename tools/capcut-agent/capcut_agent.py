"""CapCut activity agent.

Heartbeats one editor's CapCut usage to Supabase every minute. It records only:
  - whether CapCut.exe is running
  - whether CapCut is the focused (foreground) window  -> active vs idle
  - CapCut's own window title (the project name) when focused
  - the machine name

It is transparent and CapCut-only: it does NOT read other applications, capture
keystrokes, or take screenshots. It runs quietly in the background and writes a
small local log next to itself.

Config lives at the top of this file and can be overridden by a
`capcut_config.json` placed next to the script/exe.
"""
import os
import sys
import json
import time
import platform
import datetime
import urllib.request
import urllib.error

import psutil
import win32gui
import win32process

# Use the OS trust store (Windows SChannel) for TLS so the agent works behind
# antivirus / corporate HTTPS interception (e.g. Avast) that injects its own
# root CA. Python's bundled CA list would otherwise reject those certs. On a
# machine without interception this just uses the normal public roots.
try:
    import truststore
    truststore.inject_into_ssl()
except Exception:
    pass

# --- Config (override per-machine via capcut_config.json next to this file) ---
CONFIG = {
    "WORKER": "sam",                 # editor id this machine belongs to (Jay = "sam")
    "SUPABASE_URL": "https://kjruhbaahqkuajseoojn.supabase.co",
    "ANON_KEY": "sb_publishable_dwqdtQk9W7xNHgHn2kJbkA_2DNMz6uK",
    "POLL_SECONDS": 15,              # sample every 15s for near-real-time tracking
    "CAPCUT_PROCESS": "CapCut.exe",
    # CapCut's window title is just "CapCut" (no project name), so the open
    # project is read from disk: each project is a folder here, and the most
    # recently-modified one is the project being edited.
    "DRAFT_DIR": r"%LOCALAPPDATA%\CapCut\User Data\Projects\com.lveditor.draft",
    "PROJECT_RECENT_MIN": 20,        # report the open project if its draft changed within 20 min
                                     # (bridges autosave gaps so the project stays visible in pauses)
}


def _base_dir():
    # When frozen by PyInstaller, files sit next to the .exe.
    return os.path.dirname(sys.executable if getattr(sys, "frozen", False) else os.path.abspath(__file__))


def load_config():
    path = os.path.join(_base_dir(), "capcut_config.json")
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                CONFIG.update(json.load(f))
        except Exception as e:
            _log(f"config read error: {e}")
    # Env override — lets one machine run as a different worker without editing
    # the shared config (e.g. the owner tracking their own CapCut as "paul").
    if os.environ.get("CAPCUT_WORKER"):
        CONFIG["WORKER"] = os.environ["CAPCUT_WORKER"].strip()
    return CONFIG


def _log(msg):
    try:
        with open(os.path.join(_base_dir(), "capcut_agent.log"), "a", encoding="utf-8") as f:
            f.write(f"{datetime.datetime.now().isoformat(timespec='seconds')}  {msg}\n")
    except Exception:
        pass


def capcut_pids(proc_name):
    """PIDs of every running CapCut process."""
    name = proc_name.lower()
    pids = set()
    for p in psutil.process_iter(["pid", "name"]):
        try:
            if (p.info.get("name") or "").lower() == name:
                pids.add(p.info["pid"])
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    return pids


def foreground_pid_and_title():
    hwnd = win32gui.GetForegroundWindow()
    if not hwnd:
        return None, ""
    try:
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        return pid, (win32gui.GetWindowText(hwnd) or "")
    except Exception:
        return None, ""


def active_project(cfg):
    """The CapCut project currently being edited = the project folder whose
    draft was modified most recently (CapCut autosaves while you edit). Returns
    the folder name (= project name), or None if nothing changed recently."""
    draft_dir = os.path.expandvars(cfg.get("DRAFT_DIR", ""))
    if not draft_dir or not os.path.isdir(draft_dir):
        return None
    newest_name, newest_m = None, 0.0
    try:
        for entry in os.scandir(draft_dir):
            # Real projects are folders that contain draft_meta_info.json. This
            # skips system folders like ".recycle_bin" and dotfolders.
            if not entry.is_dir() or entry.name.startswith("."):
                continue
            meta = os.path.join(entry.path, "draft_meta_info.json")
            try:
                m = os.path.getmtime(meta)   # raises if missing -> not a project
            except OSError:
                continue
            if m > newest_m:
                newest_m, newest_name = m, entry.name
    except OSError:
        return None
    if newest_name and (time.time() - newest_m) <= cfg.get("PROJECT_RECENT_MIN", 6) * 60:
        return newest_name[:200]
    return None


def send_heartbeat(cfg, running, focused, project_title):
    payload = json.dumps([{
        "worker": cfg["WORKER"],
        "running": running,
        "focused": focused,
        "project_title": project_title,
        "machine": platform.node(),
    }]).encode("utf-8")
    req = urllib.request.Request(
        cfg["SUPABASE_URL"].rstrip("/") + "/rest/v1/capcut_activity",
        data=payload, method="POST",
        headers={
            "apikey": cfg["ANON_KEY"],
            "Authorization": "Bearer " + cfg["ANON_KEY"],
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return 200 <= resp.status < 300
    except urllib.error.HTTPError as e:
        body = b""
        try:
            body = e.read()[:300]
        except Exception:
            pass
        _log(f"HTTP {e.code}: {body!r}")
    except Exception as e:
        _log(f"send error: {e}")
    return False


def main():
    cfg = load_config()
    _log(f"agent start - worker={cfg['WORKER']} machine={platform.node()} poll={cfg['POLL_SECONDS']}s")
    while True:
        try:
            pids = capcut_pids(cfg["CAPCUT_PROCESS"])
            running = len(pids) > 0
            # Only heartbeat while CapCut is actually open. Closed time is
            # inferred from the absence of recent heartbeats — this keeps the
            # row count to real CapCut-usage minutes (well under Supabase's
            # 1000-row read cap) instead of logging idle machine time 24/7.
            if running:
                fg_pid, _ = foreground_pid_and_title()
                focused = fg_pid in pids
                # Read the open project from disk (works whether or not CapCut is
                # the foreground window — captures the project being edited).
                project_title = active_project(cfg)
                send_heartbeat(cfg, True, focused, project_title)
        except Exception as e:
            _log(f"loop error: {e}")
        time.sleep(max(15, int(cfg.get("POLL_SECONDS", 60))))


if __name__ == "__main__":
    main()
