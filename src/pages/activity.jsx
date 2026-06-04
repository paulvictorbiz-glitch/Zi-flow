/* =========================================================
   Activity — private CapCut usage monitor (localhost only).

   Reads heartbeats from Supabase `capcut_activity` (written by the
   desktop agent on the editor's PC) and shows time in CapCut, active
   vs idle, current project, live status, and a 7-day bar.

   This page is only mounted on localhost (see app.jsx IS_LOCALHOST),
   so it never appears on the public site.
   ========================================================= */

import React, { useEffect, useMemo, useState } from "react";
import { DPill } from "../components/components.jsx";
import { PEOPLE } from "../lib/shared-data.jsx";
import { supabase } from "../lib/supabase-client.js";

const MIN_PER_HEARTBEAT = 1;   // agent sends ~1 heartbeat/minute while CapCut is open
const ONLINE_WINDOW_MS = 2.5 * 60 * 1000;  // last heartbeat within 2.5 min => CapCut open now

function startOfDayLocal(offsetDays = 0) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d;
}

function fmtDuration(minutes) {
  const m = Math.round(minutes);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

// Most recent heartbeats (for live status + current project).
async function loadRecent(worker) {
  const { data, error } = await supabase
    .from("capcut_activity")
    .select("ts, running, focused, project_title, machine")
    .eq("worker", worker)
    .order("ts", { ascending: false })
    .limit(30);
  if (error) { console.error("capcut recent:", error.message); return []; }
  return data || [];
}

// Today's rows (local day) for active/idle totals. Capped at 1000 — a full
// CapCut workday is well under that.
async function loadToday(worker) {
  const { data, error } = await supabase
    .from("capcut_activity")
    .select("ts, running, focused, project_title")
    .eq("worker", worker)
    .gte("ts", startOfDayLocal(0).toISOString())
    .order("ts", { ascending: false })
    .limit(1000);
  if (error) { console.error("capcut today:", error.message); return []; }
  return data || [];
}

// Per-day running-heartbeat counts for the last `days` days (one cheap count
// query each, in parallel — avoids the 1000-row read cap for multi-day spans).
async function loadDailyMinutes(worker, days = 7) {
  const reqs = [];
  for (let i = days - 1; i >= 0; i--) {
    const start = startOfDayLocal(-i);
    const end = startOfDayLocal(-i + 1);
    reqs.push(
      supabase
        .from("capcut_activity")
        .select("*", { count: "exact", head: true })
        .eq("worker", worker)
        .eq("running", true)
        .gte("ts", start.toISOString())
        .lt("ts", end.toISOString())
        .then(({ count }) => ({
          label: start.toLocaleDateString(undefined, { weekday: "short" }),
          dayNum: start.getDate(),
          minutes: (count || 0) * MIN_PER_HEARTBEAT,
        }))
    );
  }
  return Promise.all(reqs);
}

function liveStatus(recent) {
  const latest = recent[0];
  if (!latest) return { dot: "⚫", label: "No CapCut activity yet", tone: "var(--fg-mute)" };
  const ageMs = Date.now() - new Date(latest.ts).getTime();
  if (ageMs <= ONLINE_WINDOW_MS) {
    return latest.focused
      ? { dot: "🟢", label: "Editing now", tone: "var(--c-green, #4ade80)" }
      : { dot: "🟡", label: "CapCut open · idle", tone: "var(--c-amber, #f59e0b)" };
  }
  return { dot: "⚫", label: "Not in CapCut", tone: "var(--fg-mute)" };
}

export function Activity({ workerId = "sam" }) {
  const person = PEOPLE[workerId];
  const name = person?.name || workerId;

  const [recent, setRecent] = useState([]);
  const [today, setToday]   = useState([]);
  const [daily, setDaily]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [tableMissing, setTableMissing] = useState(false);

  const refresh = async () => {
    const [r, t, d] = await Promise.all([
      loadRecent(workerId), loadToday(workerId), loadDailyMinutes(workerId, 7),
    ]);
    // Heuristic: if everything is empty AND the recent query errored on a
    // missing table, surface the setup hint.
    setRecent(r); setToday(t); setDaily(d); setLoading(false);
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    // Probe the table once so we can show a friendly "run the SQL" hint.
    supabase.from("capcut_activity").select("id", { head: true, count: "exact" }).limit(1)
      .then(({ error }) => { if (alive && error && /capcut_activity/.test(error.message)) setTableMissing(true); });
    refresh();
    const iv = setInterval(() => { if (alive) refresh(); }, 45000);
    return () => { alive = false; clearInterval(iv); };
  }, [workerId]);

  const runMin = today.length * MIN_PER_HEARTBEAT;
  const activeMin = today.filter(r => r.focused).length * MIN_PER_HEARTBEAT;
  const idleMin = Math.max(0, runMin - activeMin);
  const status = useMemo(() => liveStatus(recent), [recent]);
  const currentProject = (today.find(r => r.project_title) || {}).project_title
    || (recent.find(r => r.project_title) || {}).project_title || null;
  const maxDay = Math.max(1, ...daily.map(d => d.minutes));

  return (
    <div>
      <div className="page-head">
        <div className="titles">
          <h1>Activity 🔒</h1>
          <div className="sub">
            Private CapCut monitor for <strong>{name}</strong> — visible only on your local machine.
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
            <div className="mono" style={{ fontSize: 12, color: "var(--c-amber, #f59e0b)", marginBottom: 6 }}>
              Table <code>capcut_activity</code> not found
            </div>
            <div className="mono dim" style={{ fontSize: 11, lineHeight: 1.6 }}>
              Run the CREATE TABLE SQL from <code>tools/capcut-agent/README.md</code> in the Supabase
              SQL editor, then start the agent on the editor's PC.
            </div>
          </div>
        )}

        {/* Today's numbers */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <StatCard label="CapCut time today" value={fmtDuration(runMin)} accent="var(--c-cyan, #22d3ee)" />
          <StatCard label="Active (editing)" value={fmtDuration(activeMin)} accent="var(--c-green, #4ade80)" />
          <StatCard label="Idle (open, unfocused)" value={fmtDuration(idleMin)} accent="var(--c-amber, #f59e0b)" />
          <StatCard label="Current project" value={currentProject || "—"} accent="var(--fg)" small />
        </div>

        {/* 7-day bar */}
        <div className="card" style={{ padding: "16px 18px" }}>
          <div className="mono dim" style={{ fontSize: 10, marginBottom: 14, letterSpacing: ".06em" }}>
            CAPCUT TIME · LAST 7 DAYS
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 130 }}>
            {daily.map((d, i) => (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, height: "100%", justifyContent: "flex-end" }}>
                <div className="mono dim" style={{ fontSize: 10 }}>{d.minutes ? fmtDuration(d.minutes) : ""}</div>
                <div title={fmtDuration(d.minutes)} style={{
                  width: "70%", borderRadius: "3px 3px 0 0",
                  height: `${Math.max(2, (d.minutes / maxDay) * 100)}%`,
                  background: i === daily.length - 1 ? "var(--c-cyan, #22d3ee)" : "var(--line-hard, #64748b)",
                  transition: "height .2s",
                }} />
                <div className="mono dim" style={{ fontSize: 10 }}>{d.label}</div>
              </div>
            ))}
            {daily.length === 0 && (
              <div className="mono dim" style={{ fontSize: 12, padding: "40px 0" }}>
                {loading ? "Loading…" : "No data yet."}
              </div>
            )}
          </div>
        </div>

        {/* Recent activity */}
        <div className="card" style={{ padding: "16px 18px" }}>
          <div className="mono dim" style={{ fontSize: 10, marginBottom: 12, letterSpacing: ".06em" }}>
            RECENT HEARTBEATS
          </div>
          {recent.length === 0 ? (
            <div className="mono dim" style={{ fontSize: 12 }}>
              {loading ? "Loading…" : "No heartbeats yet — is the agent running on the editor's PC?"}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {recent.slice(0, 12).map((r, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "7px 0",
                  borderBottom: i < 11 ? "1px solid var(--line)" : "none", fontSize: 12,
                }}>
                  <span className="mono dim" style={{ width: 130, flexShrink: 0 }}>
                    {new Date(r.ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span style={{ flexShrink: 0, color: r.focused ? "var(--c-green, #4ade80)" : "var(--c-amber, #f59e0b)" }}>
                    {r.focused ? "● editing" : "○ idle"}
                  </span>
                  <span style={{ flex: 1, color: "var(--fg-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.project_title || "—"}
                  </span>
                  {r.machine && <span className="mono dim" style={{ fontSize: 10, flexShrink: 0 }}>{r.machine}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, accent, small }) {
  return (
    <div className="card" style={{ flex: "1 1 180px", minWidth: 160, padding: "14px 16px" }}>
      <div className="mono dim" style={{ fontSize: 10, letterSpacing: ".06em", marginBottom: 8 }}>
        {label.toUpperCase()}
      </div>
      <div style={{
        fontSize: small ? 15 : 26, fontWeight: 600, color: accent,
        fontFamily: small ? "var(--f-sans)" : "var(--f-mono)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {value}
      </div>
    </div>
  );
}
