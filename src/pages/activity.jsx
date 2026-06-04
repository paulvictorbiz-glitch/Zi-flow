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
import { PEOPLE } from "../lib/shared-data.jsx";
import { supabase } from "../lib/supabase-client.js";

const NOMINAL_POLL_SEC = 15;          // agent sample rate — used only for the 7-day bar estimate
const GAP_CAP_MS = 90 * 1000;         // a sample represents at most 90s (caps breaks/missed beats)
const ONLINE_WINDOW_MS = 45 * 1000;   // last heartbeat within 45s => CapCut open right now
const SESSION_GAP_MIN = 4;            // gap > 4 min between samples => new session
const REFRESH_MS = 12 * 1000;

function startOfDayLocal(offsetDays = 0, base) {
  const d = base ? new Date(base) : new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d;
}
function fmtDuration(min) {
  const m = Math.round(min);
  if (m <= 0) return "0m";
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
    .eq("worker", worker).order("ts", { ascending: false }).limit(40);
  if (error) { console.error("capcut recent:", error.message); return []; }
  return data || [];
}
// All of a day's rows (ascending), paginated past the 1000-row read cap.
async function loadDayRows(worker, dayStart) {
  const dayEnd = startOfDayLocal(1, dayStart);
  const all = []; let from = 0; const page = 1000;
  for (let guard = 0; guard < 25; guard++) {
    const { data, error } = await supabase
      .from("capcut_activity")
      .select("ts, running, focused, project_title")
      .eq("worker", worker)
      .gte("ts", dayStart.toISOString()).lt("ts", dayEnd.toISOString())
      .order("ts", { ascending: true }).range(from, from + page - 1);
    if (error) { console.error("capcut day:", error.message); break; }
    all.push(...(data || []));
    if (!data || data.length < page) break;
    from += page;
  }
  return all;
}
async function loadDailyMinutes(worker, days = 7) {
  const reqs = [];
  for (let i = days - 1; i >= 0; i--) {
    const start = startOfDayLocal(-i);
    reqs.push(
      supabase.from("capcut_activity").select("*", { count: "exact", head: true })
        .eq("worker", worker).eq("running", true)
        .gte("ts", start.toISOString()).lt("ts", startOfDayLocal(-i + 1).toISOString())
        .then(({ count }) => ({ start, minutes: (count || 0) * NOMINAL_POLL_SEC / 60 }))
    );
  }
  return Promise.all(reqs);
}

// ---- derivation: everything from timestamp gaps --------------------------
function analyzeDay(rowsAsc, nowMs) {
  const n = rowsAsc.length;
  const span = rowsAsc.map((r, i) => {
    const t = new Date(r.ts).getTime();
    const next = i + 1 < n ? new Date(rowsAsc[i + 1].ts).getTime() : nowMs;
    return Math.min(Math.max(next - t, 0), GAP_CAP_MS);
  });
  let total = 0, active = 0;
  const proj = {}, hourly = Array(24).fill(0);
  for (let i = 0; i < n; i++) {
    total += span[i];
    if (rowsAsc[i].focused) active += span[i];
    const p = rowsAsc[i].project_title;
    if (p) proj[p] = (proj[p] || 0) + span[i];
    hourly[new Date(rowsAsc[i].ts).getHours()] += span[i];
  }
  // sessions: split on a time gap OR a project change
  const sessions = []; let cur = null;
  for (let i = 0; i < n; i++) {
    const r = rowsAsc[i], t = new Date(r.ts).getTime(), p = r.project_title || null;
    const gap = cur ? t - cur.lastT : Infinity;
    const projChanged = cur && p && cur.project && p !== cur.project;
    if (cur && gap <= SESSION_GAP_MIN * 60000 && !projChanged) {
      cur.lastT = t; cur.end = r.ts; cur.ms += span[i]; if (r.focused) cur.activeMs += span[i];
      if (p) { cur.projects[p] = (cur.projects[p] || 0) + span[i]; if (!cur.project) cur.project = p; }
    } else {
      if (cur) sessions.push(cur);
      cur = { start: r.ts, end: r.ts, lastT: t, ms: span[i], activeMs: r.focused ? span[i] : 0, projects: {}, project: p };
      if (p) cur.projects[p] = span[i];
    }
  }
  if (cur) sessions.push(cur);
  return {
    totalMin: total / 60000, activeMin: active / 60000, idleMin: Math.max(0, total - active) / 60000,
    sessions: sessions.reverse(),
    projects: Object.entries(proj).map(([k, v]) => [k, v / 60000]).sort((a, b) => b[1] - a[1]),
    hourly: hourly.map(ms => ms / 60000),
  };
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
export function Activity({ workerId = "sam" }) {
  const name = PEOPLE[workerId]?.name || workerId;
  const [recent, setRecent] = useState([]);
  const [daily, setDaily]   = useState([]);
  const [selectedDay, setSelectedDay] = useState(() => startOfDayLocal(0));
  const [dayRows, setDayRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [tableMissing, setTableMissing] = useState(false);
  const selRef = useRef(selectedDay);
  selRef.current = selectedDay;

  const refresh = async () => {
    const [r, d, dr] = await Promise.all([
      loadRecent(workerId), loadDailyMinutes(workerId, 7), loadDayRows(workerId, selRef.current),
    ]);
    setRecent(r); setDaily(d); setDayRows(dr); setLoading(false); setUpdatedAt(new Date());
  };

  useEffect(() => {
    let alive = true; setLoading(true);
    supabase.from("capcut_activity").select("id", { head: true, count: "exact" }).limit(1)
      .then(({ error }) => { if (alive && error && /capcut_activity/.test(error.message)) setTableMissing(true); });
    refresh();
    const iv = setInterval(() => { if (alive) refresh(); }, REFRESH_MS);
    return () => { alive = false; clearInterval(iv); };
  }, [workerId]);

  useEffect(() => { loadDayRows(workerId, selectedDay).then(setDayRows); }, [workerId, selectedDay]);

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
            Private CapCut monitor for <strong>{name}</strong> — visible only on your local machine.
            Logs 24/7 from {name}'s PC even when this dashboard is closed.
          </div>
        </div>
        <div className="actions">
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
