/* =========================================================
   Activity — private CapCut usage monitor (localhost only).

   Reads heartbeats from Supabase `capcut_activity` (written by the
   desktop agent on the editor's PC) and shows time in CapCut, active
   vs idle, current project, live status, a 7-day bar, and a clickable
   per-day drill-down: time-log sessions, per-project time, hourly timeline.

   Only mounted on localhost (see app.jsx IS_LOCALHOST) — never on the
   public site.
   ========================================================= */

import React, { useEffect, useMemo, useState } from "react";
import { DPill } from "../components/components.jsx";
import { PEOPLE } from "../lib/shared-data.jsx";
import { supabase } from "../lib/supabase-client.js";

const MIN_PER_HB = 1;                 // agent sends ~1 heartbeat/min while CapCut is open
const ONLINE_WINDOW_MS = 2.5 * 60 * 1000;
const SESSION_GAP_MIN = 4;            // gap > 4 min between heartbeats => new session

function startOfDayLocal(offsetDays = 0, base) {
  const d = base ? new Date(base) : new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d;
}
function fmtDuration(min) {
  const m = Math.round(min);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
function fmtClock(ts) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

// ---- queries -------------------------------------------------------------
async function loadRecent(worker) {
  const { data, error } = await supabase
    .from("capcut_activity")
    .select("ts, running, focused, project_title, machine")
    .eq("worker", worker).order("ts", { ascending: false }).limit(30);
  if (error) { console.error("capcut recent:", error.message); return []; }
  return data || [];
}
async function loadDayRows(worker, dayStart) {
  const dayEnd = startOfDayLocal(1, dayStart);
  const { data, error } = await supabase
    .from("capcut_activity")
    .select("ts, running, focused, project_title")
    .eq("worker", worker)
    .gte("ts", dayStart.toISOString()).lt("ts", dayEnd.toISOString())
    .order("ts", { ascending: true }).limit(1000);
  if (error) { console.error("capcut day:", error.message); return []; }
  return data || [];
}
async function loadDailyMinutes(worker, days = 7) {
  const reqs = [];
  for (let i = days - 1; i >= 0; i--) {
    const start = startOfDayLocal(-i);
    reqs.push(
      supabase.from("capcut_activity").select("*", { count: "exact", head: true })
        .eq("worker", worker).eq("running", true)
        .gte("ts", start.toISOString()).lt("ts", startOfDayLocal(-i + 1).toISOString())
        .then(({ count }) => ({ start, minutes: (count || 0) * MIN_PER_HB }))
    );
  }
  return Promise.all(reqs);
}

// ---- derivations ---------------------------------------------------------
function buildSessions(rows) {
  const sorted = [...rows].sort((a, b) => new Date(a.ts) - new Date(b.ts));
  const out = [];
  let cur = null;
  for (const r of sorted) {
    const t = new Date(r.ts).getTime();
    const proj = r.project_title || null;
    const gap = cur ? t - cur.lastT : Infinity;
    // New session when there's a time gap OR the editor switched to a different
    // project (so each project's work shows as its own time-log entry).
    const projChanged = cur && proj && cur.project && proj !== cur.project;
    if (cur && gap <= SESSION_GAP_MIN * 60000 && !projChanged) {
      cur.lastT = t; cur.end = r.ts; cur.count++;
      if (r.focused) cur.active++;
      if (proj) { cur.projects[proj] = (cur.projects[proj] || 0) + 1; if (!cur.project) cur.project = proj; }
    } else {
      if (cur) out.push(cur);
      cur = { start: r.ts, end: r.ts, lastT: t, count: 1, active: r.focused ? 1 : 0, projects: {}, project: proj };
      if (proj) cur.projects[proj] = 1;
    }
  }
  if (cur) out.push(cur);
  return out.reverse();   // newest session first
}
function primaryProject(projects) {
  const e = Object.entries(projects);
  if (!e.length) return null;
  return e.sort((a, b) => b[1] - a[1])[0][0];
}
function dayProjectTotals(rows) {
  const m = {};
  rows.forEach(r => { if (r.project_title) m[r.project_title] = (m[r.project_title] || 0) + MIN_PER_HB; });
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
}
function hourlyBuckets(rows) {
  const buckets = Array(24).fill(0);
  rows.forEach(r => { buckets[new Date(r.ts).getHours()] += MIN_PER_HB; });
  return buckets;
}
function liveStatus(recent) {
  const latest = recent[0];
  if (!latest) return { dot: "⚫", label: "No CapCut activity yet", tone: "var(--fg-mute)" };
  const age = Date.now() - new Date(latest.ts).getTime();
  if (age <= ONLINE_WINDOW_MS) {
    return latest.focused
      ? { dot: "🟢", label: "Editing now", tone: "var(--c-green, #4ade80)" }
      : { dot: "🟡", label: "CapCut open · idle", tone: "var(--c-amber, #f59e0b)" };
  }
  return { dot: "⚫", label: "Not in CapCut", tone: "var(--fg-mute)" };
}

// =========================================================================
export function Activity({ workerId = "sam" }) {
  const name = PEOPLE[workerId]?.name || workerId;
  const [recent, setRecent] = useState([]);
  const [daily, setDaily]   = useState([]);
  const [selectedDay, setSelectedDay] = useState(() => startOfDayLocal(0));
  const [dayRows, setDayRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tableMissing, setTableMissing] = useState(false);

  const refresh = async () => {
    const [r, d, dr] = await Promise.all([
      loadRecent(workerId), loadDailyMinutes(workerId, 7), loadDayRows(workerId, selectedDay),
    ]);
    setRecent(r); setDaily(d); setDayRows(dr); setLoading(false);
  };

  useEffect(() => {
    let alive = true; setLoading(true);
    supabase.from("capcut_activity").select("id", { head: true, count: "exact" }).limit(1)
      .then(({ error }) => { if (alive && error && /capcut_activity/.test(error.message)) setTableMissing(true); });
    refresh();
    const iv = setInterval(() => { if (alive) refresh(); }, 45000);
    return () => { alive = false; clearInterval(iv); };
  }, [workerId]);

  // Reload the day panel whenever the selected day changes.
  useEffect(() => { loadDayRows(workerId, selectedDay).then(setDayRows); }, [workerId, selectedDay]);

  const status = useMemo(() => liveStatus(recent), [recent]);
  const isToday = selectedDay.getTime() === startOfDayLocal(0).getTime();
  const maxDay = Math.max(1, ...daily.map(d => d.minutes));

  return (
    <div>
      <div className="page-head">
        <div className="titles">
          <h1>Activity 🔒</h1>
          <div className="sub">
            Private CapCut monitor for <strong>{name}</strong> — visible only on your local machine.
            Logs 24/7 from {name}'s PC even when this dashboard is closed.
          </div>
        </div>
        <div className="actions">
          <DPill>{status.dot} {status.label}</DPill>
          <DPill onClick={refresh}>↻ Refresh</DPill>
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

        {/* 7-day bar — click a day to drill in */}
        <div className="card" style={{ padding: "16px 18px" }}>
          <div className="mono dim" style={{ fontSize: 10, marginBottom: 14, letterSpacing: ".06em" }}>
            CAPCUT TIME · LAST 7 DAYS · click a day for detail
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
                  <div className="mono dim" style={{ fontSize: 10 }}>{d.minutes ? fmtDuration(d.minutes) : ""}</div>
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
  const sessions = useMemo(() => buildSessions(rows), [rows]);
  const projects = useMemo(() => dayProjectTotals(rows), [rows]);
  const hourly = useMemo(() => hourlyBuckets(rows), [rows]);
  const total = rows.length * MIN_PER_HB;
  const active = rows.filter(r => r.focused).length * MIN_PER_HB;
  const idle = Math.max(0, total - active);
  const maxHour = Math.max(1, ...hourly);
  const maxProj = Math.max(1, ...projects.map(p => p[1]));

  return (
    <div className="card" style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontFamily: "var(--f-serif, serif)", fontStyle: "italic", fontSize: 18, color: "var(--fg)" }}>{label}</div>
        <span className="mono" style={{ fontSize: 12, color: "var(--c-cyan, #22d3ee)" }}>{fmtDuration(total)} in CapCut</span>
        <span className="mono dim" style={{ fontSize: 12 }}>· {fmtDuration(active)} editing · {fmtDuration(idle)} idle</span>
        <span className="mono dim" style={{ fontSize: 12 }}>· {sessions.length} session{sessions.length === 1 ? "" : "s"}</span>
      </div>

      {rows.length === 0 ? (
        <div className="mono dim" style={{ fontSize: 12 }}>{loading ? "Loading…" : "No CapCut activity recorded this day."}</div>
      ) : (
        <>
          {/* Time log */}
          <div>
            <div className="mono dim" style={{ fontSize: 10, marginBottom: 8, letterSpacing: ".06em" }}>TIME LOG</div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {sessions.map((s, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "8px 0",
                  borderBottom: i < sessions.length - 1 ? "1px solid var(--line)" : "none", fontSize: 12.5,
                }}>
                  <span className="mono" style={{ width: 150, flexShrink: 0, color: "var(--fg)" }}>
                    {fmtClock(s.start)} – {fmtClock(s.end)}
                  </span>
                  <span className="mono" style={{ width: 60, flexShrink: 0, color: "var(--c-cyan, #22d3ee)" }}>
                    {fmtDuration(s.count * MIN_PER_HB)}
                  </span>
                  <span style={{ flex: 1, color: "var(--fg-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {primaryProject(s.projects) || "—"}
                  </span>
                  <span className="mono dim" style={{ fontSize: 10.5, flexShrink: 0 }}>
                    {fmtDuration(s.active * MIN_PER_HB)} editing
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Projects */}
          {projects.length > 0 && (
            <div>
              <div className="mono dim" style={{ fontSize: 10, marginBottom: 8, letterSpacing: ".06em" }}>PROJECTS</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {projects.map(([proj, min], i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
                    <span style={{ width: 180, flexShrink: 0, color: "var(--fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{proj}</span>
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
              {hourly.map((m, h) => (
                <div key={h} title={`${h}:00 — ${fmtDuration(m)}`} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
                  <div style={{ width: "80%", height: `${(m / maxHour) * 100}%`, minHeight: m ? 2 : 0, background: "var(--c-cyan, #22d3ee)", borderRadius: "2px 2px 0 0" }} />
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
