/* =========================================================
   Activity — private CapCut usage monitor (localhost only).

   Reads heartbeats from Supabase `capcut_activity` (written by the
   desktop agent on the editor's PC) and shows time in CapCut, active
   vs idle, current project, live status, a 7-day bar, and a clickable
   per-day drill-down: time-log sessions, per-project time, hourly timeline.

   Time is computed from real timestamp gaps (not "1 sample = 1 min"), so it's
   accurate at any agent sample rate. Only mounted on localhost (see app.jsx).
   ========================================================= */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { DPill } from "../components/components.jsx";
import { useRoster } from "../lib/roster.jsx";
import { useAuth } from "../auth.jsx";
import { supabase } from "../lib/supabase-client.js";
import { NOMINAL_POLL_SEC, GAP_CAP_MS, ONLINE_WINDOW_MS, SESSION_GAP_MIN, startOfDayLocal, analyzeDay, fmtDuration, fmtClock, loadDayRows } from "../lib/capcut-utils.js";
import JSZip from "jszip";

const REFRESH_MS = 12 * 1000;

// ---- queries -------------------------------------------------------------
async function loadRecent(worker) {
  const { data, error } = await supabase
    .from("capcut_activity")
    .select("ts, running, focused, project_title, machine")
    .eq("worker", worker).order("ts", { ascending: false }).limit(40);
  if (error) { console.error("capcut recent:", error.message); return []; }
  return data || [];
}
async function loadDailyMinutes(worker, days = 7, baseDate) {
  const reqs = [];
  for (let i = days - 1; i >= 0; i--) {
    const start = startOfDayLocal(-i, baseDate);
    reqs.push(
      supabase.from("capcut_activity").select("*", { count: "exact", head: true })
        .eq("worker", worker).eq("running", true)
        .gte("ts", start.toISOString()).lt("ts", startOfDayLocal(-i + 1, baseDate).toISOString())
        .then(({ count }) => ({ start, minutes: (count || 0) * NOMINAL_POLL_SEC / 60 }))
    );
  }
  return Promise.all(reqs);
}

async function downloadAgentFiles(personId) {
  const zip = new JSZip();

  zip.file("capcut_config.json", JSON.stringify({ WORKER: personId, POLL_SECONDS: 15 }, null, 2));

  const bat = [
    "@echo off",
    "REM CapCut activity tracker — one-time install. Run from the folder you unzipped into.",
    "setlocal",
    "set TASK=CapCutActivityAgent",
    "set EXE=%~dp0capcut_agent.exe",
    "",
    "if not exist \"%EXE%\" (",
    "  echo ERROR: capcut_agent.exe not found in this folder.",
    "  pause & exit /b 1",
    ")",
    "",
    "schtasks /Create /TN \"%TASK%\" /TR \"\\\"%EXE%\\\"\" /SC ONLOGON /RL LIMITED /F",
    "if errorlevel 1 ( echo Failed to create scheduled task. & pause & exit /b 1 )",
    "",
    "echo Installed. Starting agent now...",
    "schtasks /Run /TN \"%TASK%\"",
    "echo Done. The agent is running and will auto-start at every logon.",
    "pause",
  ].join("\r\n");
  zip.file("install.bat", bat);

  try {
    const resp = await fetch("/capcut-agent/capcut_agent.exe");
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const exeBytes = await resp.arrayBuffer();
    zip.file("capcut_agent.exe", exeBytes);
  } catch (e) {
    alert("Could not fetch capcut_agent.exe — check that it's deployed under /capcut-agent/.\n\n" + e.message);
    return;
  }

  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 1 } });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `CapCutTracker-${personId}.zip`; a.click();
  URL.revokeObjectURL(url);
}

function primaryProject(projects) {
  const e = Object.entries(projects);
  return e.length ? e.sort((a, b) => b[1] - a[1])[0][0] : null;
}
function liveStatus(recent) {
  const latest = recent[0];
  if (!latest) return { dot: "⚫", label: "No CapCut activity yet" };
  if (Date.now() - new Date(latest.ts).getTime() <= ONLINE_WINDOW_MS) {
    return latest.focused ? { dot: "🟢", label: "Editing now" } : { dot: "🟡", label: "CapCut open · idle" };
  }
  return { dot: "⚫", label: "Not in CapCut" };
}

// =========================================================================
const navBtnStyle = {
  background: "none", border: "1px dashed var(--line-hard)", borderRadius: 3,
  color: "var(--fg-mute)", fontFamily: "var(--f-mono)", fontSize: 10, padding: "3px 8px", cursor: "pointer",
};

export function Activity({ workerId = "paul" }) {
  const { peopleList, peopleById } = useRoster();
  const { person: signedIn } = useAuth();
  // Who can be tracked — every team member runs the agent on their own PC
  // with their person id as the WORKER id.
  const WORKER_OPTIONS = useMemo(
    () => peopleList.map(p => ({ k: p.id, name: p.name })),
    [peopleList]
  );
  const [worker, setWorker] = useState(workerId);   // whose CapCut usage to view
  const name = peopleById[worker]?.name || worker;
  const [recent, setRecent] = useState([]);
  const [daily, setDaily]   = useState([]);
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState(() => startOfDayLocal(0));
  const [dayRows, setDayRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [tableMissing, setTableMissing] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const selRef = useRef(selectedDay);
  selRef.current = selectedDay;

  const weekBase = useMemo(() => {
    const d = startOfDayLocal(0);
    d.setDate(d.getDate() + weekOffset * 7);
    return d;
  }, [weekOffset]);

  const refresh = async () => {
    const [r, d, dr] = await Promise.all([
      loadRecent(worker), loadDailyMinutes(worker, 7, weekBase), loadDayRows(worker, selRef.current, supabase),
    ]);
    setRecent(r); setDaily(d); setDayRows(dr); setLoading(false); setUpdatedAt(new Date());
  };

  useEffect(() => {
    let alive = true; setLoading(true); setRecent([]); setDaily([]); setDayRows([]);
    supabase.from("capcut_activity").select("id", { head: true, count: "exact" }).limit(1)
      .then(({ error }) => { if (alive && error && /capcut_activity/.test(error.message)) setTableMissing(true); });
    refresh();
    const iv = setInterval(() => { if (alive) refresh(); }, REFRESH_MS);
    return () => { alive = false; clearInterval(iv); };
  }, [worker, weekBase]);

  useEffect(() => {
    const last = startOfDayLocal(0, weekBase);
    setSelectedDay(last);
  }, [weekOffset]);

  useEffect(() => { loadDayRows(worker, selectedDay, supabase).then(setDayRows); }, [worker, selectedDay]);

  const status = useMemo(() => liveStatus(recent), [recent]);
  const curProject = (recent[0] && Date.now() - new Date(recent[0].ts).getTime() <= ONLINE_WINDOW_MS)
    ? recent[0].project_title : null;
  const isToday = selectedDay.getTime() === startOfDayLocal(0).getTime();
  const maxDay = Math.max(1, ...daily.map(d => d.minutes));

  return (
    <div>
      <div className="page-head">
        <div className="titles">
          <h1>Activity 🔒</h1>
          <div className="sub">
            Private CapCut monitor — visible only on your local machine.
            Logs 24/7 from <strong>{name}</strong>'s PC even when this dashboard is closed.
          </div>
        </div>
        <div className="actions">
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span className="mono dim" style={{ fontSize: 10 }}>tracking</span>
            <select
              value={worker}
              onChange={e => setWorker(e.target.value)}
              style={{
                padding: "5px 10px", border: "1px dashed var(--line-hard, var(--border))",
                borderRadius: 14, background: "var(--bg-2)", color: "var(--fg)",
                fontFamily: "var(--f-mono)", fontSize: 11.5, cursor: "pointer",
              }}
            >
              {WORKER_OPTIONS.map(w => (
                <option key={w.k} value={w.k}>{w.name}{w.k === signedIn?.id ? " (me)" : ""}</option>
              ))}
            </select>
          </label>
          <DPill>{status.dot} {status.label}{curProject ? ` · ${curProject}` : ""}</DPill>
          <DPill onClick={refresh}>↻ Refresh</DPill>
          {updatedAt && <span className="mono dim" style={{ fontSize: 10, alignSelf: "center" }}>
            updated {updatedAt.toLocaleTimeString()}
          </span>}
        </div>
      </div>

      <div style={{ padding: "0 22px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
        {tableMissing && (
          <div className="card" style={{ padding: 16, borderColor: "var(--c-amber-soft, #f59e0b)" }}>
            <div className="mono" style={{ fontSize: 12, color: "var(--c-amber, #f59e0b)" }}>
              Table <code>capcut_activity</code> not found — run the setup SQL from
              <code> tools/capcut-agent/README.md</code>.
            </div>
          </div>
        )}

        {/* Install tracker card */}
        <div className="card" style={{ padding: "12px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div className="mono dim" style={{ fontSize: 10, letterSpacing: ".06em" }}>CAPCUT TRACKER · SETUP</div>
            <button onClick={() => setInstallOpen(o => !o)} style={{ background: "none", border: "none", color: "var(--fg-mute)", fontFamily: "var(--f-mono)", fontSize: 10, cursor: "pointer" }}>
              {installOpen ? "▲ hide" : "▼ show"}
            </button>
          </div>
          {installOpen && (
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 12, color: "var(--fg-mute)", lineHeight: 1.6 }}>
                The tracker is a small Windows background app that reports CapCut usage every 15 s.
                Each team member runs it on their own PC.
              </div>
              <div style={{ fontSize: 11.5, color: "var(--fg)", lineHeight: 1.7 }}>
                <b>Setup:</b> Click the button below to download a zip pre-configured for {name}.
                Unzip it anywhere permanent, then double-click <code>install.bat</code> — the agent
                installs and starts automatically. No other files needed.
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                <button
                  onClick={() => downloadAgentFiles(worker)}
                  style={{ padding: "5px 12px", border: "1px dashed var(--c-cyan)", borderRadius: 3, background: "rgba(107,214,224,0.08)", color: "var(--c-cyan)", fontFamily: "var(--f-mono)", fontSize: 10.5, cursor: "pointer" }}>
                  ↓ Download CapCutTracker-{name}.zip
                </button>
                <span className="mono dim" style={{ fontSize: 10, alignSelf: "center" }}>
                  · includes the agent, config, and install script
                </span>
              </div>
            </div>
          )}
        </div>

        {/* 7-day bar — click a day to drill in */}
        <div className="card" style={{ padding: "16px 18px" }}>
          <div className="mono dim" style={{ fontSize: 10, marginBottom: 6, letterSpacing: ".06em" }}>
            CAPCUT TIME · click a day for detail
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <button onClick={() => setWeekOffset(o => o - 1)} style={navBtnStyle}>← Prev</button>
            <span className="mono dim" style={{ fontSize: 10.5, flex: 1, textAlign: "center" }}>
              {daily.length > 0
                ? `${daily[0].start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${daily[daily.length - 1].start.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
                : ""}
            </span>
            <button onClick={() => setWeekOffset(o => o + 1)} disabled={weekOffset >= 0} style={{ ...navBtnStyle, opacity: weekOffset >= 0 ? 0.35 : 1 }}>Next →</button>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 130 }}>
            {daily.map((d, i) => {
              const sel = d.start.getTime() === selectedDay.getTime();
              return (
                <button key={i} onClick={() => setSelectedDay(d.start)}
                  title={`${d.start.toLocaleDateString()} · ${fmtDuration(d.minutes)}`}
                  style={{
                    flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                    height: "100%", justifyContent: "flex-end", background: "none", border: "none",
                    cursor: "pointer", padding: 0,
                  }}>
                  <div className="mono dim" style={{ fontSize: 10 }}>{d.minutes >= 1 ? fmtDuration(d.minutes) : ""}</div>
                  <div style={{
                    width: "72%", borderRadius: "3px 3px 0 0",
                    height: `${Math.max(2, (d.minutes / maxDay) * 100)}%`,
                    background: sel ? "var(--c-cyan, #22d3ee)" : "var(--line-hard, #64748b)",
                    outline: sel ? "2px solid var(--c-cyan, #22d3ee)" : "none", outlineOffset: 2,
                    transition: "height .2s",
                  }} />
                  <div className="mono" style={{ fontSize: 10, color: sel ? "var(--c-cyan, #22d3ee)" : "var(--fg-dim)" }}>
                    {d.start.toLocaleDateString(undefined, { weekday: "short" })} {d.start.getDate()}
                  </div>
                </button>
              );
            })}
            {daily.length === 0 && (
              <div className="mono dim" style={{ fontSize: 12, padding: "40px 0" }}>
                {loading ? "Loading…" : "No data yet — is the agent running on the editor's PC?"}
              </div>
            )}
          </div>
        </div>

        <DayDetail
          rows={dayRows}
          label={isToday ? "Today" : selectedDay.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
          loading={loading}
        />
      </div>
    </div>
  );
}

// ---- per-day detail ------------------------------------------------------
function DayDetail({ rows, label, loading }) {
  const a = useMemo(() => analyzeDay(rows, Date.now()), [rows]);
  const maxHour = Math.max(1, ...a.hourly);
  const maxProj = Math.max(1, ...a.projects.map(p => p[1]));

  return (
    <div className="card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontFamily: "var(--f-serif, serif)", fontStyle: "italic", fontSize: 18, color: "var(--fg)" }}>{label}</div>
        <span className="mono" style={{ fontSize: 12, color: "var(--c-cyan, #22d3ee)" }}>{fmtDuration(a.totalMin)} in CapCut</span>
        <span className="mono dim" style={{ fontSize: 12 }}>· {fmtDuration(a.activeMin)} editing · {fmtDuration(a.idleMin)} idle</span>
        <span className="mono dim" style={{ fontSize: 12 }}>· {a.sessions.length} session{a.sessions.length === 1 ? "" : "s"}</span>
      </div>

      {rows.length === 0 ? (
        <div className="mono dim" style={{ fontSize: 12 }}>{loading ? "Loading…" : "No CapCut activity recorded this day."}</div>
      ) : (
        <>
          {/* Time log */}
          <div>
            <div className="mono dim" style={{ fontSize: 10, marginBottom: 8, letterSpacing: ".06em" }}>TIME LOG · by project session</div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {a.sessions.map((s, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "8px 0",
                  borderBottom: i < a.sessions.length - 1 ? "1px solid var(--line)" : "none", fontSize: 12.5,
                }}>
                  <span className="mono" style={{ width: 150, flexShrink: 0, color: "var(--fg)" }}>
                    {fmtClock(s.start)} – {fmtClock(s.end)}
                  </span>
                  <span className="mono" style={{ width: 60, flexShrink: 0, color: "var(--c-cyan, #22d3ee)" }}>
                    {fmtDuration(s.ms / 60000)}
                  </span>
                  <span style={{ flex: 1, color: "var(--fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {primaryProject(s.projects) || "—"}
                  </span>
                  <span className="mono dim" style={{ fontSize: 10.5, flexShrink: 0 }}>
                    {fmtDuration(s.activeMs / 60000)} editing
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Projects */}
          {a.projects.length > 0 && (
            <div>
              <div className="mono dim" style={{ fontSize: 10, marginBottom: 8, letterSpacing: ".06em" }}>PROJECTS</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {a.projects.map(([proj, min], i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
                    <span style={{ width: 200, flexShrink: 0, color: "var(--fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{proj}</span>
                    <div style={{ flex: 1, height: 10, background: "var(--bg-2)", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ width: `${(min / maxProj) * 100}%`, height: "100%", background: "var(--c-green, #4ade80)" }} />
                    </div>
                    <span className="mono dim" style={{ width: 60, flexShrink: 0, textAlign: "right" }}>{fmtDuration(min)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Hourly timeline */}
          <div>
            <div className="mono dim" style={{ fontSize: 10, marginBottom: 8, letterSpacing: ".06em" }}>BY HOUR</div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 56 }}>
              {a.hourly.map((m, h) => (
                <div key={h} title={`${h}:00 — ${fmtDuration(m)}`} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
                  <div style={{ width: "80%", height: `${(m / maxHour) * 100}%`, minHeight: m > 0.05 ? 2 : 0, background: "var(--c-cyan, #22d3ee)", borderRadius: "2px 2px 0 0" }} />
                  {h % 6 === 0 && <div className="mono dim" style={{ fontSize: 8, marginTop: 3 }}>{h}</div>}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
