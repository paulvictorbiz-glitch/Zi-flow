/* =========================================================
   Monitor hub — owner-only intelligence surface.

   Consolidates the three formerly-separate owner dashboards
   (infra Monitor, Pulse, AI Brain) into ONE tab with a sub-tab
   strip, mirroring the Pipeline sub-mode bar and the Reel DNA /
   AI-Brain internal sub-tab pattern.

   • Each sub-tab is gated independently by canView() so the
     owner's per-role grants still apply per sub-view.
   • The hub tab itself only mounts when at least one of the
     three is allowed (gating wired in app.jsx via canViewView).
   • Mounts the existing page components AS-IS — composition,
     not surgery; their internal state/effects are untouched.
   ========================================================= */
import React, { useState, useEffect, useMemo } from "react";
import { Card, DPill } from "../components/components.jsx";
import { Monitor } from "./monitor.jsx";
import { Pulse } from "./pulse.jsx";
import { AIBrain } from "./ai-brain.jsx";
import { Scout } from "./scout.jsx";
import { supabase } from "../lib/supabase-client.js";
import { useIsOwner } from "../lib/permissions.jsx";
// .mon-spark* / .mon-stat-* live in monitor.css; import it here so the
// perf card is styled even when the Infra sub-tab (which also imports it)
// isn't the mounted sub-view. CSS imports are idempotent/deduped by Vite.
import "./monitor.css";

const MONITOR_MODE_KEY = "wb_monitor_mode";

const SOL_MONITOR_CSS = `
[data-theme="solarin"] .mon-wrap {
  max-width: 1320px; margin: 0 auto; padding: 28px 32px; box-sizing: border-box;
  font-family: var(--f-ui);
}
[data-theme="solarin"] .mon-hud-header {
  background: var(--hud-panel); border: 1px solid var(--hud-border);
  padding: 16px 20px; margin-bottom: 16px;
  display: flex; align-items: center; gap: 16px;
}
[data-theme="solarin"] .mon-hud-title {
  font-family: var(--f-label); font-size: 16px; font-weight: 700;
  color: var(--orange-bright); letter-spacing: .08em; text-transform: uppercase;
}
[data-theme="solarin"] .mon-hud-sub {
  font-family: var(--f-label); font-size: 10px; color: var(--amber-hud);
  text-transform: uppercase; letter-spacing: .1em;
}
[data-theme="solarin"] .mon-nominal-chip {
  font-family: var(--f-label); font-size: 10px; font-weight: 700;
  text-transform: uppercase; letter-spacing: .08em;
  border: 1px solid var(--hud-ok); color: var(--hud-ok); padding: 3px 10px;
}
[data-theme="solarin"] .mon-refresh-btn {
  font-family: var(--f-label); font-size: 10px; text-transform: uppercase;
  letter-spacing: .06em; background: none;
  border: 1px solid var(--orange); color: var(--orange);
  padding: 4px 12px; cursor: pointer; transition: background .15s;
}
[data-theme="solarin"] .mon-refresh-btn:hover { background: rgba(255,138,42,.1); }
[data-theme="solarin"] .mon-gauge-row {
  display: grid; grid-template-columns: repeat(5,1fr); gap: 12px; margin-bottom: 16px;
}
[data-theme="solarin"] .mon-gauge {
  background: var(--hud-panel); border: 1px solid var(--hud-border);
  padding: 16px; display: flex; flex-direction: column; align-items: center; gap: 8px;
}
[data-theme="solarin"] .mon-gauge-ring {
  width: 78px; height: 78px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center; position: relative;
}
[data-theme="solarin"] .mon-gauge-inner {
  width: 58px; height: 58px; border-radius: 50%; background: #0d0a07;
  display: flex; align-items: center; justify-content: center;
  font-family: var(--f-label); font-size: 15px; font-weight: 700; color: var(--orange-bright);
}
[data-theme="solarin"] .mon-gauge-label {
  font-family: var(--f-label); font-size: 10px; color: var(--amber-hud);
  text-transform: uppercase; letter-spacing: .06em; text-align: center;
}
[data-theme="solarin"] .mon-grid {
  display: grid; grid-template-columns: repeat(3,1fr); gap: 14px;
}
[data-theme="solarin"] .mon-panel {
  background: var(--hud-panel); border: 1px solid var(--hud-border); padding: 14px 16px;
}
[data-theme="solarin"] .mon-panel-head {
  display: flex; align-items: center; gap: 8px; margin-bottom: 12px;
  padding-bottom: 8px; border-bottom: 1px solid var(--hud-border);
}
[data-theme="solarin"] .mon-panel-title {
  font-family: var(--f-label); font-size: 10.5px; font-weight: 700;
  text-transform: uppercase; letter-spacing: .1em; color: var(--orange-bright);
}
[data-theme="solarin"] .mon-status-dot {
  width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
  animation: pulseGlowGreen 2.5s ease-in-out infinite;
}
[data-theme="solarin"] .mon-status-dot.ok    { background: var(--hud-ok); }
[data-theme="solarin"] .mon-status-dot.alert { background: var(--hud-alert); animation: none; }
[data-theme="solarin"] .mon-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 5px 0; font-size: 12px;
}
[data-theme="solarin"] .mon-row-key {
  font-family: var(--f-label); font-size: 9.5px; color: var(--hud-muted);
  text-transform: uppercase; letter-spacing: .04em;
}
[data-theme="solarin"] .mon-row-val {
  font-family: var(--f-label); font-size: 11.5px; font-weight: 700; color: var(--orange-bright);
}
[data-theme="solarin"] .mon-sparkline {
  display: flex; align-items: flex-end; gap: 2px; height: 28px; margin: 6px 0;
}
[data-theme="solarin"] .mon-spark-bar { flex: 1; background: var(--orange); min-height: 2px; }
[data-theme="solarin"] .mon-panel-footer {
  font-family: var(--f-label); font-size: 9.5px; color: var(--amber-hud);
  text-transform: uppercase; letter-spacing: .06em;
  margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--hud-border);
  cursor: pointer;
}
[data-theme="solarin"] .mon-panel-footer:hover { color: var(--orange); }
`;

/* ── D5: Frontend-performance card ───────────────────────────
   Owner-only. Client-queries perf_samples directly (NO new
   api/* route — the 12-fn Vercel cap is full). Surfaces p75
   load_ms + an INP "lag" indicator + a daily-median sparkline
   that REUSES the Monitor's existing SVG sparkline renderer
   (same .mon-spark* classes from monitor.css). Degrades to a
   "no samples yet" empty state when perf_samples is empty or
   absent (migration 0086 may not be applied during this run). */

const PERF_WINDOW_DAYS = 7;
const PERF_SPARK_COLOR = "var(--c-cyan)";

// Percentile over a numeric array (linear-interpolation, p in 0..1).
function percentile(sorted, p) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return percentile(s, 0.5);
}

// INP lag thresholds mirror web-vitals INP scoring (ms):
//  good ≤200, needs-improvement ≤500, poor >500.
// Tone strings map to the existing .mon-stat-v--{ok,amber,red} classes.
function inpTone(ms) {
  if (ms == null) return "";
  if (ms <= 200) return "ok";
  if (ms <= 500) return "amber";
  return "red";
}

// Same SVG markup + classes as monitor.jsx's <Sparkline> (reused
// renderer, kept local because that one isn't exported).
function PerfSparkline({ values = [], color = PERF_SPARK_COLOR, label }) {
  if (!values || values.length < 2) return null;
  const w = 200, h = 36, pad = 2;
  const max = Math.max(...values, 1);
  const n = values.length;
  const pts = values
    .map((v, i) => {
      const x = pad + (i / (n - 1)) * (w - pad * 2);
      const y = pad + (1 - v / max) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <div className="mon-spark-wrap">
      <svg className="mon-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5"
          strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {label && <div className="mon-spark-label">{label}</div>}
    </div>
  );
}

function FrontendPerfCard({ onStats }) {
  const isOwner = useIsOwner();
  const [state, setState] = useState({ status: "loading", rows: [] });

  useEffect(() => {
    if (!isOwner) return;
    let cancelled = false;
    (async () => {
      const since = new Date(Date.now() - PERF_WINDOW_DAYS * 86400000).toISOString();
      const { data, error } = await supabase
        .from("perf_samples")
        .select("id, person_id, path, load_ms, lcp_ms, inp_ms, cls, ttfb_ms, ua, created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: true })
        .limit(5000);
      if (cancelled) return;
      // Missing table / RLS denial / migration-not-applied → empty state,
      // never a thrown boot error (table may not exist this run).
      if (error) { setState({ status: "empty", rows: [] }); return; }
      setState({ status: "ready", rows: data || [] });
    })();
    return () => { cancelled = true; };
  }, [isOwner]);

  const stats = useMemo(() => {
    const rows = state.rows;
    const loads = rows.map(r => r.load_ms).filter(v => typeof v === "number");
    const inps = rows.map(r => r.inp_ms).filter(v => typeof v === "number");

    const p75Load = loads.length
      ? Math.round(percentile([...loads].sort((a, b) => a - b), 0.75))
      : null;
    const p75Inp = inps.length
      ? Math.round(percentile([...inps].sort((a, b) => a - b), 0.75))
      : null;

    // Daily-median load_ms over the window, oldest→newest, for the sparkline.
    const byDay = new Map();
    for (const r of rows) {
      if (typeof r.load_ms !== "number" || !r.created_at) continue;
      const day = String(r.created_at).slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push(r.load_ms);
    }
    const dailyMedians = [...byDay.keys()]
      .sort()
      .map(day => median(byDay.get(day)))
      .filter(v => v != null);

    return { count: rows.length, p75Load, p75Inp, dailyMedians };
  }, [state.rows]);

  // Bubble derived stats up so the HUD gauge row can bind real values.
  // Pure notification — does not alter queries/effects/state ownership.
  useEffect(() => { if (onStats) onStats(stats); }, [onStats, stats]);

  if (!isOwner) return null;

  const empty = state.status === "empty" || (state.status === "ready" && stats.count === 0);
  const tone = inpTone(stats.p75Inp);

  return (
    <Card
      title="Frontend performance"
      right={<span className="mono dim">last {PERF_WINDOW_DAYS}d · real-user</span>}
      footLeft="web-vitals · perf_samples (client query)"
    >
      <div className="mon-section-body">
        {state.status === "loading" && (
          <div className="mono dim" style={{ padding: "4px 0" }}>loading samples…</div>
        )}

        {state.status !== "loading" && empty && (
          <div className="mono dim" style={{ padding: "4px 0" }}>
            no samples yet — perf tracking has not reported any data
            {" "}(migration 0086 / perf_samples may not be live).
          </div>
        )}

        {state.status !== "loading" && !empty && (
          <>
            <div className="mon-stats-grid">
              <div className="mon-stat-row">
                <span className="mon-stat-k">p75 load</span>
                <span className="mon-stat-v">
                  {stats.p75Load != null ? `${stats.p75Load} ms` : "—"}
                </span>
              </div>
              <div className="mon-stat-row">
                <span className="mon-stat-k">INP lag (p75)</span>
                <span className={`mon-stat-v${tone ? " mon-stat-v--" + tone : ""}`}>
                  {stats.p75Inp != null ? `${stats.p75Inp} ms` : "—"}
                  {stats.p75Inp != null && (
                    <span className="mono dim" style={{ marginLeft: 6 }}>
                      {tone === "ok" ? "good" : tone === "amber" ? "fair" : "laggy"}
                    </span>
                  )}
                </span>
              </div>
              <div className="mon-stat-row">
                <span className="mon-stat-k">samples</span>
                <span className="mon-stat-v">{stats.count}</span>
              </div>
            </div>
            {stats.dailyMedians.length >= 2 ? (
              <PerfSparkline
                values={stats.dailyMedians}
                color={PERF_SPARK_COLOR}
                label="daily-median load_ms"
              />
            ) : (
              <div className="mono dim" style={{ paddingTop: 6 }}>
                not enough days for a trend yet
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

/* ── Editor usage tracker + history ──────────────────────────
   Owner-only. Surfaces who is using the embedded OpenCut editor —
   LIVE now (fresh oc_locks write-holders + open editor_usage_sessions)
   and OVER TIME (per-person totals + a daily-sessions sparkline).
   Client-queries both tables directly (NO new api/* route — the
   12-fn Vercel cap is full), exactly like FrontendPerfCard. Degrades
   to a "no usage yet" empty state when editor_usage_sessions is empty
   or absent (migration 0097 may not be applied during this run), and
   tolerates oc_locks being absent independently. */

const USAGE_WINDOW_DAYS = 14;
// A session row with ended_at NULL is only counted "open" while its
// last_active_at is fresh — 3× the 60s heartbeat — so a missed end stamp
// (hard tab-close) never shows a ghost session as live.
const USAGE_OPEN_WINDOW_MS = 3 * 60_000;
const USAGE_SPARK_COLOR = "var(--c-violet, var(--c-cyan))";

function fmtDur(ms) {
  if (!ms || ms < 0) return "0m";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function fmtAgo(iso) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function EditorUsageCard({ onStats }) {
  const isOwner = useIsOwner();
  const [state, setState] = useState({ status: "loading", sessions: [], locks: [] });
  const [tick, setTick] = useState(0); // manual / interval refresh

  useEffect(() => {
    if (!isOwner) return;
    let cancelled = false;
    (async () => {
      const since = new Date(Date.now() - USAGE_WINDOW_DAYS * 86400000).toISOString();
      // History log + live fork write-locks, in parallel. Each degrades
      // INDEPENDENTLY — a missing oc_locks must not blank the history, and a
      // missing usage table must not throw.
      const [sessRes, lockRes] = await Promise.all([
        supabase
          .from("editor_usage_sessions")
          .select("id, project_id, reel_id, person_id, person_name, preset, source, started_at, last_active_at, ended_at")
          .gte("started_at", since)
          .order("started_at", { ascending: true })
          .limit(5000),
        supabase
          .from("oc_locks")
          .select("project_id, locked_by, locked_by_name, locked_at, expires_at")
          .limit(200),
      ]);
      if (cancelled) return;
      // Missing usage table / RLS denial → empty state (never a thrown boot error).
      if (sessRes.error) { setState({ status: "empty", sessions: [], locks: [] }); return; }
      setState({
        status: "ready",
        sessions: sessRes.data || [],
        locks: lockRes.error ? [] : (lockRes.data || []),
      });
    })();
    return () => { cancelled = true; };
  }, [isOwner, tick]);

  // Light auto-refresh so "live now" stays current without a manual click.
  useEffect(() => {
    if (!isOwner) return;
    const h = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(h);
  }, [isOwner]);

  const stats = useMemo(() => {
    const now = Date.now();
    const sessions = state.sessions;

    // Live now: fork write-lock holders (fresh expires_at) ∪ open usage sessions
    // (ended_at NULL and last_active_at within the open window).
    const liveLocks = (state.locks || []).filter(l =>
      l.expires_at && new Date(l.expires_at).getTime() > now
    );
    const openSessions = sessions.filter(s =>
      !s.ended_at && s.last_active_at && (now - new Date(s.last_active_at).getTime()) < USAGE_OPEN_WINDOW_MS
    );
    const liveNames = new Set();
    liveLocks.forEach(l => liveNames.add(l.locked_by_name || l.locked_by || "editor"));
    openSessions.forEach(s => liveNames.add(s.person_name || s.person_id || "editor"));

    // Per-person history: sessions, total active time, last seen.
    const byPerson = new Map();
    for (const s of sessions) {
      const key = s.person_id || s.person_name || "unknown";
      const end = s.ended_at ? new Date(s.ended_at).getTime() : Math.min(now, new Date(s.last_active_at || s.started_at).getTime());
      const dur = Math.max(0, end - new Date(s.started_at).getTime());
      const cur = byPerson.get(key) || { name: s.person_name || s.person_id || "unknown", count: 0, ms: 0, last: 0 };
      cur.count += 1;
      cur.ms += dur;
      cur.last = Math.max(cur.last, new Date(s.last_active_at || s.started_at).getTime());
      if (s.person_name) cur.name = s.person_name;
      byPerson.set(key, cur);
    }
    const people = [...byPerson.values()].sort((a, b) => b.last - a.last);

    // Daily session counts over the window (oldest→newest) for the sparkline.
    const byDay = new Map();
    for (const s of sessions) {
      if (!s.started_at) continue;
      const day = String(s.started_at).slice(0, 10);
      byDay.set(day, (byDay.get(day) || 0) + 1);
    }
    const dailyCounts = [...byDay.keys()].sort().map(d => byDay.get(d));

    const totalMs = sessions.reduce((acc, s) => {
      const end = s.ended_at ? new Date(s.ended_at).getTime() : Math.min(now, new Date(s.last_active_at || s.started_at).getTime());
      return acc + Math.max(0, end - new Date(s.started_at).getTime());
    }, 0);

    return {
      count: sessions.length,
      liveCount: liveNames.size,
      liveNames: [...liveNames],
      people,
      dailyCounts,
      totalMs,
    };
  }, [state.sessions, state.locks]);

  // Bubble derived stats up so the HUD gauge row can bind real values.
  useEffect(() => { if (onStats) onStats(stats); }, [onStats, stats]);

  if (!isOwner) return null;

  const empty = state.status === "empty" || (state.status === "ready" && stats.count === 0);

  return (
    <Card
      title="Editor usage"
      right={
        <span className="mono dim">
          last {USAGE_WINDOW_DAYS}d ·{" "}
          <button
            type="button"
            className="mon-link-btn"
            onClick={() => setTick(t => t + 1)}
            style={{ background: "none", border: 0, color: "inherit", cursor: "pointer", padding: 0, font: "inherit", textDecoration: "underline" }}
            title="Refresh now"
          >
            refresh
          </button>
        </span>
      }
      footLeft="editor_usage_sessions + oc_locks (client query)"
    >
      <div className="mon-section-body">
        {/* Live-now banner — always shown (even with no history) so the owner
            can see who is in the editor right this moment. */}
        <div className="mon-stat-row" style={{ marginBottom: 8 }}>
          <span className="mon-stat-k">editing now</span>
          <span className={`mon-stat-v${stats.liveCount ? " mon-stat-v--ok" : ""}`}>
            {stats.liveCount > 0
              ? `${stats.liveCount} · ${stats.liveNames.join(", ")}`
              : "nobody"}
          </span>
        </div>

        {state.status === "loading" && (
          <div className="mono dim" style={{ padding: "4px 0" }}>loading usage…</div>
        )}

        {state.status !== "loading" && empty && (
          <div className="mono dim" style={{ padding: "4px 0" }}>
            no editor usage recorded yet — open a project in the editor to start
            logging{" "}(migration 0097 / editor_usage_sessions may not be live).
          </div>
        )}

        {state.status !== "loading" && !empty && (
          <>
            <div className="mon-stats-grid">
              <div className="mon-stat-row">
                <span className="mon-stat-k">sessions</span>
                <span className="mon-stat-v">{stats.count}</span>
              </div>
              <div className="mon-stat-row">
                <span className="mon-stat-k">total edit time</span>
                <span className="mon-stat-v">{fmtDur(stats.totalMs)}</span>
              </div>
              <div className="mon-stat-row">
                <span className="mon-stat-k">people</span>
                <span className="mon-stat-v">{stats.people.length}</span>
              </div>
            </div>

            {stats.dailyCounts.length >= 2 ? (
              <PerfSparkline
                values={stats.dailyCounts}
                color={USAGE_SPARK_COLOR}
                label="sessions / day"
              />
            ) : (
              <div className="mono dim" style={{ paddingTop: 6 }}>
                not enough days for a trend yet
              </div>
            )}

            {/* Per-person breakdown — who edits, how much, last seen. */}
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
              {stats.people.slice(0, 8).map((p, i) => {
                const live = stats.liveNames.includes(p.name);
                return (
                  <div key={i} className="mon-stat-row">
                    <span className="mon-stat-k">
                      {live ? "🟢 " : ""}{p.name}
                    </span>
                    <span className="mon-stat-v mono dim" style={{ fontSize: 11 }}>
                      {p.count} session{p.count === 1 ? "" : "s"} · {fmtDur(p.ms)} · {fmtAgo(new Date(p.last).toISOString())}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

/* ── CapCut tracker installs (download / run audit) ──────────
   Owner-only. Surfaces who DOWNLOADED the CapCut tracker and the
   result of RUNNING it (install.bat self-test + the agent starting),
   from capcut_install_events (migration 0100). Client-queries the
   table directly (no new api/* route — the 12-fn Vercel cap is full),
   like the cards above. Degrades to a "no install activity yet" empty
   state when the table is absent/empty (0100 may not be applied yet). */

const INSTALLS_WINDOW_DAYS = 14;

function CapCutInstallsCard({ onStats }) {
  const isOwner = useIsOwner();
  const [state, setState] = useState({ status: "loading", events: [] });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!isOwner) return;
    let cancelled = false;
    (async () => {
      const since = new Date(Date.now() - INSTALLS_WINDOW_DAYS * 86400000).toISOString();
      const { data, error } = await supabase
        .from("capcut_install_events")
        .select("id, ts, worker, install_id, event, ok, detail, machine, os, client")
        .gte("ts", since)
        .order("ts", { ascending: false })
        .limit(2000);
      if (cancelled) return;
      // Missing table / RLS denial → empty state (never a thrown boot error).
      if (error) { setState({ status: "empty", events: [] }); return; }
      setState({ status: "ready", events: data || [] });
    })();
    return () => { cancelled = true; };
  }, [isOwner, tick]);

  useEffect(() => {
    if (!isOwner) return;
    const h = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(h);
  }, [isOwner]);

  const stats = useMemo(() => {
    const events = state.events;
    const now = Date.now();
    const byWorker = new Map();
    for (const e of events) {
      const key = e.worker || "unknown";
      const cur = byWorker.get(key) || {
        worker: key, downloads: 0, selftestPass: 0, selftestFail: 0,
        agentStarts: 0, last: 0, machines: new Set(), lastSelftest: null,
      };
      if (e.event === "download") cur.downloads += 1;
      else if (e.event === "selftest") {
        if (e.ok) cur.selftestPass += 1; else cur.selftestFail += 1;
        if (!cur.lastSelftest) cur.lastSelftest = e;   // events are ts-desc → first = latest
      } else if (e.event === "agent_start") cur.agentStarts += 1;
      if (e.machine) cur.machines.add(e.machine);
      cur.last = Math.max(cur.last, new Date(e.ts).getTime());
      byWorker.set(key, cur);
    }
    const workers = [...byWorker.values()].sort((a, b) => b.last - a.last);
    const recentCount = events.filter(e => now - new Date(e.ts).getTime() < 86400000).length;
    return { workers, recentCount, total: events.length, recent: events.slice(0, 12) };
  }, [state.events]);

  useEffect(() => { if (onStats) onStats(stats); }, [onStats, stats]);

  if (!isOwner) return null;

  const empty = state.status === "empty" || (state.status === "ready" && stats.total === 0);
  const evtLabel = { download: "⬇ download", selftest: "▶ self-test", agent_start: "● agent start" };

  return (
    <Card
      title="CapCut tracker installs"
      right={
        <span className="mono dim">
          last {INSTALLS_WINDOW_DAYS}d ·{" "}
          <button
            type="button"
            className="mon-link-btn"
            onClick={() => setTick(t => t + 1)}
            style={{ background: "none", border: 0, color: "inherit", cursor: "pointer", padding: 0, font: "inherit", textDecoration: "underline" }}
            title="Refresh now"
          >
            refresh
          </button>
        </span>
      }
      footLeft="capcut_install_events (client query)"
    >
      <div className="mon-section-body">
        <div className="mon-stat-row" style={{ marginBottom: 8 }}>
          <span className="mon-stat-k">activity (24h)</span>
          <span className={`mon-stat-v${stats.recentCount ? " mon-stat-v--ok" : ""}`}>
            {stats.recentCount > 0 ? `${stats.recentCount} event${stats.recentCount === 1 ? "" : "s"}` : "none"}
          </span>
        </div>

        {state.status === "loading" && (
          <div className="mono dim" style={{ padding: "4px 0" }}>loading installs…</div>
        )}

        {state.status !== "loading" && empty && (
          <div className="mono dim" style={{ padding: "4px 0" }}>
            no install activity yet — someone must download &amp; run the tracker
            {" "}(migration 0100 / capcut_install_events may not be live).
          </div>
        )}

        {state.status !== "loading" && !empty && (
          <>
            {/* Per-person rollup: downloads vs. successful runs. */}
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {stats.workers.slice(0, 8).map((w, i) => {
                const ran = w.selftestPass > 0 || w.agentStarts > 0;
                const lastSelfOk = w.lastSelftest ? w.lastSelftest.ok : null;
                return (
                  <div key={i} className="mon-stat-row">
                    <span className="mon-stat-k">
                      {ran ? "🟢 " : "⚪ "}{w.worker}
                    </span>
                    <span className="mon-stat-v mono dim" style={{ fontSize: 11 }}>
                      ⬇{w.downloads} · self-test {w.selftestPass}✓{w.selftestFail ? `/${w.selftestFail}✗` : ""}
                      {" "}· starts {w.agentStarts}
                      {lastSelfOk === false ? " · ⚠ last run FAILED" : ""}
                      {" "}· {fmtAgo(new Date(w.last).toISOString())}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Raw recent-events log so the owner can watch attempts come in. */}
            <div style={{ marginTop: 10 }}>
              <div className="mono dim" style={{ marginBottom: 4 }}>recent events</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {stats.recent.map((e) => (
                  <div key={e.id} className="mono dim" style={{ fontSize: 10.5, display: "flex", gap: 8 }}>
                    <span style={{ minWidth: 64 }}>{fmtAgo(e.ts)}</span>
                    <span style={{ minWidth: 70 }}>{e.worker}</span>
                    <span style={{ minWidth: 96 }}>{evtLabel[e.event] || e.event}</span>
                    <span style={{ opacity: 0.8 }}>
                      {e.event === "selftest" ? (e.ok ? "PASS" : "FAIL") : ""}
                      {e.machine ? ` ${e.machine}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

// view = the permission-catalog key each sub-view is gated by (preserved
// verbatim from when these were top-level tabs, so gating never changes).
const SUBVIEWS = [
  { key: "infra",  label: "Infra",    view: "monitor", Comp: Monitor },
  { key: "pulse",  label: "Pulse",    view: "pulse",   Comp: Pulse },
  { key: "ai",     label: "AI Brain", view: "ai",      Comp: AIBrain },
  { key: "scout",  label: "Scout",    view: "scout",   Comp: Scout },
];

// Clamp any numeric to a 0..100 conic-gradient percentage.
function gaugePct(v) {
  if (v == null || !isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

export function MonitorHub({ canView }) {
  const allowed = useMemo(() => SUBVIEWS.filter(s => canView(s.view)), [canView]);

  // Real derived stats lifted from the two owner data cards (no new queries).
  const [perfStats, setPerfStats] = useState(null);
  const [usageStats, setUsageStats] = useState(null);
  const [installStats, setInstallStats] = useState(null);
  const isOwner = useIsOwner();   // gate the kept owner cards

  const [mode, setMode] = useState(() => localStorage.getItem(MONITOR_MODE_KEY) || "infra");

  // Land on the first allowed sub-tab when the persisted one isn't currently
  // granted (a role with only Pulse must not land on a blank Infra screen).
  const activeKey = allowed.some(s => s.key === mode) ? mode : (allowed[0]?.key ?? null);

  useEffect(() => { if (activeKey && activeKey !== mode) setMode(activeKey); }, [activeKey, mode]);
  useEffect(() => { localStorage.setItem(MONITOR_MODE_KEY, mode); }, [mode]);

  if (allowed.length === 0) return null;   // defensive: hub only mounts when ≥1 granted

  const Active = (allowed.find(s => s.key === activeKey) || allowed[0]).Comp;

  const liveEditing = (usageStats?.liveCount || 0) > 0;

  return (
    <div className="mon-wrap">
      {allowed.length > 1 && (
        <div className="submode-bar">
          <span className="mono dim" style={{ alignSelf: "center" }}>monitor</span>
          {allowed.map(s => (
            <DPill key={s.key} active={activeKey === s.key} onClick={() => setMode(s.key)}>
              {s.label}
            </DPill>
          ))}
          <span style={{ flex: 1 }} />
          <span className="mono dim" style={{ alignSelf: "center" }}>owner intelligence</span>
        </div>
      )}

      {/* Infrastructure-only owner cards. The two KEPT telemetry cards
          (frontend-performance graph + editor usage) render ONLY on the Infra
          sub-tab and self-gate to the owner — so Pulse / AI Brain / Scout show
          just their own function. The other HUD cards (header, gauge row, Live
          Now, Perf Vitals, Subsystems, Active View) were removed as redundant. */}
      {activeKey === "infra" && isOwner && (
      <div className="mon-grid" style={{ padding: "12px 22px 0", display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
        {/* panel 3: frontend perf */}
        <div className="mon-panel">
          <div className="mon-panel-head">
            <span className={`mon-status-dot ${perfStats?.count ? "ok" : "alert"}`} />
            <span className="mon-panel-title">Frontend Performance</span>
          </div>
          <FrontendPerfCard onStats={setPerfStats} />
        </div>
        {/* panel 4: editor usage */}
        <div className="mon-panel">
          <div className="mon-panel-head">
            <span className={`mon-status-dot ${liveEditing ? "ok" : "alert"}`} />
            <span className="mon-panel-title">Editor Usage</span>
          </div>
          <EditorUsageCard onStats={setUsageStats} />
        </div>
        {/* panel 5: capcut tracker installs */}
        <div className="mon-panel">
          <div className="mon-panel-head">
            <span className={`mon-status-dot ${installStats?.recentCount ? "ok" : "alert"}`} />
            <span className="mon-panel-title">CapCut Tracker Installs</span>
          </div>
          <CapCutInstallsCard onStats={setInstallStats} />
        </div>
      </div>
      )}

      {/* The mounted sub-view (infra Monitor / Pulse / AI Brain / Scout) —
          its own content only, exactly as each function rendered before. */}
      <div style={{ marginTop: 14 }}>
        <Active />
      </div>

      <style>{SOL_MONITOR_CSS}</style>
    </div>
  );
}
