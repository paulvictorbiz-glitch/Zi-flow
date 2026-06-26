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
import { fetchStorageStats } from "../lib/social-client.js";
import { useIsOwner } from "../lib/permissions.jsx";
import { loadGates, saveGates, isBlocked, GATE_FEATURES, loadUsage, loadDailyUsage, resetUsage } from "../lib/free-llm-gates.js";
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

export function FrontendPerfCard({ onStats }) {
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

export function EditorUsageCard({ onStats }) {
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

export function CapCutInstallsCard({ onStats }) {
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

function fmtBytes(n) {
  n = Number(n) || 0;
  if (n <= 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
}

// Storage breakdown — WHERE storage is actually used: each Supabase bucket
// (reel-videos, location-photos, …) from /api/monitor/status, plus Rocket.Chat
// video attachments vs other uploads vs messages from the JWT-gated RC route.
// Both degrade to empty rather than throwing when undeployed.
export function StorageBreakdownCard({ onStats }) {
  const isOwner = useIsOwner();
  const [state, setState] = useState({ status: "loading", buckets: [], rc: null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!isOwner) return;
    let cancelled = false;
    (async () => {
      let buckets = [];
      try {
        const r = await fetch("/api/monitor/status");
        if (r.ok) {
          const d = await r.json();
          buckets = Array.isArray(d?.supabase?.storageByBucket)
            ? d.supabase.storageByBucket : [];
        }
      } catch (_) { /* status endpoint missing → no bucket rows */ }
      const rc = await fetchStorageStats();   // null when undeployed
      if (cancelled) return;
      setState({ status: "ready", buckets, rc });
    })();
    return () => { cancelled = true; };
  }, [isOwner, tick]);

  const stats = useMemo(() => {
    const rows = [];
    for (const b of state.buckets) {
      rows.push({
        key: `sb:${b.bucket}`, label: `Supabase · ${b.bucket}`,
        bytes: b.bytes, sub: `${b.count} file${b.count === 1 ? "" : "s"}`, tone: "sb",
      });
    }
    const rc = state.rc;
    if (rc) {
      rows.push({ key: "rc:video", label: "Rocket.Chat · video attachments", bytes: rc.videoBytes || 0, sub: `${rc.videoCount || 0} clip${rc.videoCount === 1 ? "" : "s"}`, tone: "rc" });
      rows.push({ key: "rc:other", label: "Rocket.Chat · other uploads", bytes: rc.otherUploadBytes || 0, sub: `${rc.otherUploadCount || 0} file${rc.otherUploadCount === 1 ? "" : "s"}`, tone: "rc" });
      const msgFromDb = rc.messageBytesSource === "db-minus-uploads";
      rows.push({
        key: "rc:msg",
        label: `Rocket.Chat · messages ${msgFromDb ? "(db − uploads)" : "(est.)"}`,
        bytes: rc.messageBytesEstimate || 0,
        sub: `${rc.totalMessages || 0} msg`, tone: "rc",
      });
    }
    rows.sort((a, b) => (b.bytes || 0) - (a.bytes || 0));
    const total = rows.reduce((s, r) => s + (r.bytes || 0), 0);
    return { rows, total, partial: !!rc?.partial, msgExact: rc?.messageBytesSource === "db-minus-uploads" };
  }, [state.buckets, state.rc]);

  useEffect(() => { if (onStats) onStats(stats); }, [onStats, stats]);

  if (!isOwner) return null;
  const empty = state.status !== "loading" && stats.total === 0;

  return (
    <Card
      title="Storage breakdown"
      right={
        <span className="mono dim">
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
      footLeft="storage.objects + Rocket.Chat statistics"
    >
      <div className="mon-section-body">
        {state.status === "loading" && (
          <div className="mono dim" style={{ padding: "4px 0" }}>measuring storage…</div>
        )}

        {state.status !== "loading" && empty && (
          <div className="mono dim" style={{ padding: "4px 0" }}>
            no storage data — the status endpoint or Rocket.Chat stats route is
            {" "}unavailable (storage-stats may not be deployed yet).
          </div>
        )}

        {state.status !== "loading" && !empty && (
          <>
            <div className="mon-stat-row" style={{ marginBottom: 8 }}>
              <span className="mon-stat-k">total tracked</span>
              <span className="mon-stat-v">{fmtBytes(stats.total)}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {stats.rows.map(r => {
                const pctv = stats.total ? Math.round((r.bytes / stats.total) * 100) : 0;
                return (
                  <div key={r.key}>
                    <div className="mon-stat-row">
                      <span className="mon-stat-k">{r.label}</span>
                      <span className="mon-stat-v mono">
                        {fmtBytes(r.bytes)}
                        <span className="dim" style={{ marginLeft: 5 }}>{pctv}%</span>
                      </span>
                    </div>
                    <div style={{ height: 5, borderRadius: 3, background: "rgba(127,127,127,.18)", overflow: "hidden", margin: "2px 0 1px" }}>
                      <div style={{ width: `${pctv}%`, height: "100%", background: r.tone === "rc" ? "var(--c-amber, #e0a458)" : "var(--c-cyan, #46b9c8)" }} />
                    </div>
                    <div className="mono dim" style={{ fontSize: 10.5 }}>{r.sub}</div>
                  </div>
                );
              })}
            </div>
            {stats.partial && (
              <div className="mono dim" style={{ fontSize: 10.5, marginTop: 8 }}>
                ⚠ partial — some channels capped at 100 files or RC stats were
                {" "}unavailable; figures may undercount.
              </div>
            )}
            <div className="mono dim" style={{ fontSize: 10.5, marginTop: 6 }}>
              {stats.msgExact
                ? "message bytes = RC Mongo total − uploads; bucket + attachment sizes are exact."
                : "message bytes are a rough estimate (~1 KB/msg); set MONGO_URL for the exact RC total − uploads figure. bucket + attachment sizes are exact."}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

/* ── Free LLM gates card ──────────────────────────────────────
   Owner-only. Lets the owner globally disable (or selectively
   disable) all four features that burn the free OpenRouter quota.
   Persists to app_settings["free_llm_gates"] via the "owner write
   app_settings" RLS policy — same pattern as gamify_enabled.
   localStorage key "fb_free_llm_gates" keeps a sync cache so
   per-feature guards in other pages are instant (no await). */

/* ── Free-LLM usage donut ──────────────────────────────────────
   Browser-local call counts per feature, sized into a donut so the
   owner can see at a glance which feature is eating the shared free
   quota — and on which model. Data from loadUsage() (localStorage).
   Segments are grouped by model so same-model features sit adjacent. */
function FreeLLMUsageDonut({ usage, onReset }) {
  const counts = usage?.counts || {};
  const rows = GATE_FEATURES
    .map(f => ({ ...f, n: counts[f.key] || 0 }))
    .sort((a, b) => (a.model < b.model ? -1 : a.model > b.model ? 1 : 0));
  const total = rows.reduce((s, r) => s + r.n, 0);

  const R = 42, STROKE = 16, C = 2 * Math.PI * R;
  let offset = 0;

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ position: "relative", width: 116, height: 116, flexShrink: 0 }}>
        <svg width={116} height={116} viewBox="0 0 120 120">
          <circle cx={60} cy={60} r={R} fill="none"
            stroke="var(--border-dim, rgba(127,127,127,.16))" strokeWidth={STROKE} />
          {total > 0 && rows.map(r => {
            if (!r.n) return null;
            const len = (r.n / total) * C;
            const seg = (
              <circle key={r.key} cx={60} cy={60} r={R} fill="none"
                stroke={r.color} strokeWidth={STROKE}
                strokeDasharray={`${len} ${C - len}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 60 60)" strokeLinecap="butt" />
            );
            offset += len;
            return seg;
          })}
        </svg>
        <div style={{
          position: "absolute", inset: 0, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", pointerEvents: "none",
        }}>
          <div style={{ fontSize: 21, fontWeight: 700, lineHeight: 1 }}>{total}</div>
          <div className="mono dim" style={{ fontSize: 9 }}>calls</div>
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 168 }}>
        {rows.map(r => {
          const pct = total ? Math.round((r.n / total) * 100) : 0;
          return (
            <div key={r.key} style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
              <span style={{
                width: 9, height: 9, borderRadius: 2, background: r.color,
                flexShrink: 0, opacity: r.n ? 1 : 0.35,
              }} />
              <span style={{ fontSize: 11, opacity: r.n ? 1 : 0.6 }}>{r.label}</span>
              <span className="mono dim" style={{ fontSize: 9, marginLeft: "auto" }}>{r.model}</span>
              <span className="mono" style={{ fontSize: 10, minWidth: 42, textAlign: "right" }}>
                {r.n}{total ? ` · ${pct}%` : ""}
              </span>
            </div>
          );
        })}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 7 }}>
          <span className="mono dim" style={{ fontSize: 9 }}>
            {usage?.since ? `since ${new Date(usage.since).toLocaleDateString()}` : "no calls yet"} · this browser
          </span>
          <button onClick={onReset} className="mono dim" style={{
            fontSize: 9, background: "none", color: "inherit", cursor: "pointer",
            border: "1px solid var(--border-dim, rgba(127,127,127,.25))",
            borderRadius: 4, padding: "2px 7px",
          }}>reset</button>
        </div>
      </div>
    </div>
  );
}

export function FreeLLMControlCard() {
  const isOwner = useIsOwner();
  const [gates, setGates] = React.useState(null);   // null = loading
  const [saving, setSaving] = React.useState(false);
  const [usage, setUsage] = React.useState(() => loadUsage());

  React.useEffect(() => {
    if (!isOwner) return;
    loadGates().then(g => setGates({ ...g }));
    setUsage(loadUsage());
  }, [isOwner]);

  if (!isOwner) return null;

  const loading = gates === null;
  const globalOff = !!(gates?.global);
  const enabledCount = GATE_FEATURES.filter(f => !gates?.[f.key] && !globalOff).length;

  async function toggle(key, checked) {
    const next = { ...(gates || {}), [key]: checked };
    setGates(next);
    setSaving(true);
    await saveGates(next);
    setSaving(false);
  }

  return (
    <Card
      title="Free LLM gates"
      right={
        <span className="mono dim" style={{ fontSize: 11 }}>
          {loading ? "…" : saving ? "saving…" : `${enabledCount} / ${GATE_FEATURES.length} on`}
        </span>
      }
      footLeft="app_settings · free_llm_gates · owner-write"
    >
      <div className="mon-section-body">
        {loading && <div className="mono dim" style={{ padding: "4px 0" }}>loading…</div>}

        {!loading && (
          <>
            {/* Usage donut — which feature burns what, per model */}
            <div style={{
              marginBottom: 12, paddingBottom: 12,
              borderBottom: "1px solid var(--border-dim, rgba(127,127,127,.18))",
            }}>
              <FreeLLMUsageDonut usage={usage} onReset={() => { resetUsage(); setUsage(loadUsage()); }} />
            </div>

            {/* Global kill switch */}
            <label style={{
              display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
              marginBottom: 12, paddingBottom: 10,
              borderBottom: "1px solid var(--border-dim, rgba(127,127,127,.18))",
            }}>
              <input
                type="checkbox"
                checked={globalOff}
                onChange={e => toggle("global", e.target.checked)}
                style={{ width: 14, height: 14, cursor: "pointer", accentColor: "var(--c-amber, #e0a458)" }}
              />
              <span style={{ fontSize: 12, fontWeight: 700 }}>Kill ALL free LLM calls</span>
              {globalOff && (
                <span style={{
                  fontSize: 10, fontFamily: "var(--f-mono, monospace)",
                  color: "var(--c-amber, #e0a458)", letterSpacing: ".05em",
                }}>ALL BLOCKED</span>
              )}
            </label>

            {/* Per-feature checkboxes */}
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {GATE_FEATURES.map(f => {
                const blocked = !!(gates?.[f.key]);
                return (
                  <label key={f.key} style={{
                    display: "flex", alignItems: "flex-start", gap: 8,
                    cursor: globalOff ? "default" : "pointer",
                    opacity: globalOff ? 0.45 : 1,
                  }}>
                    <input
                      type="checkbox"
                      checked={blocked || globalOff}
                      disabled={globalOff}
                      onChange={e => toggle(f.key, e.target.checked)}
                      style={{
                        marginTop: 2, width: 13, height: 13,
                        cursor: globalOff ? "default" : "pointer",
                        accentColor: "var(--c-amber, #e0a458)",
                      }}
                    />
                    <div>
                      <div style={{ fontSize: 12 }}>{f.label}</div>
                      <div className="mono dim" style={{ fontSize: 10, marginTop: 1 }}>{f.desc}</div>
                    </div>
                  </label>
                );
              })}
            </div>

            <div className="mono dim" style={{ fontSize: 10, marginTop: 12 }}>
              donut counts free-LLM calls made from THIS browser since tracking began (no backfill) · blocked features show a notice in-page
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

/* ── API Budgets & Limits card ─────────────────────────────────
   Owner-only. Surfaces (a) the $300 GCP free-trial credit with a
   LIVE day-countdown to expiry (turns amber→red as it nears — the
   owner must spend it before it's lost), and (b) the escalating
   Content-Forge LLM ladder rungs + the IG Graph API, each with its
   daily limit / balance and a short description.

   Values are a maintained CONFIG constant (these limits rarely move).
   Only the day-countdown is computed live (pure Date math — no API).
   LIVE per-call usage import is NOT done here: GCP/Gemini have no
   simple usage API, and OpenRouter/Graph keys are server-side secrets
   that would need an api/* proxy (Vercel is at its 12-function cap) or
   backend header-capture. Browser-local OpenRouter call counts already
   live in the Free-LLM usage donut above. */

// $300 GCP free-trial credit. Account converted to paid 2026-06-26;
// "73 days remaining" shown 2026-06-27 → expiry ≈ 2026-09-07. Update
// `remainingNote` by eyeballing GCP → Billing → Credits when it matters.
const GCP_CREDIT = {
  amount: 300,
  currency: "USD",
  grantedOn: "2026-06-26",
  expiresOn: "2026-09-07",
  appliesTo: "Vertex AI (ladder rung 2) — NOT the Gemini API or Claude/Marketplace",
  href: "https://console.cloud.google.com/billing",   // Billing → Credits to see live balance
};

// The escalating ladder rungs (matches _forge_llm in content_forge.py)
// + the IG Graph API, which is separate from the LLM ladder.
const PROVIDER_LIMITS = [
  {
    key: "gemini_api", label: "Gemini API (AI Studio)", tone: "ok",
    rung: "Rung 1 · default", limit: "~1,500 req/day · free",
    desc: "gemini-2.0-flash · 15 req/min · free tier (no credit, no card). 30× OpenRouter's cap — the main fix for rate-limiting.",
    href: "https://aistudio.google.com/usage",
  },
  {
    key: "vertex_gemini", label: "Vertex AI (Gemini)", tone: "credit",
    rung: "Rung 2 · escalation", limit: "$300 GCP credit",
    desc: "google/gemini-2.0-flash-001 · billed to the credit above. Reliable burst capacity when the free Gemini tier is exhausted.",
    href: "https://console.cloud.google.com/vertex-ai",
  },
  {
    key: "openrouter", label: "OpenRouter (free)", tone: "warn",
    rung: "Rung 4 · safety net", limit: "~50 req/day (1,000 with $10)",
    desc: "Curated :free model chain on the MAIN key — shared by Content Forge, Reel Analyze, tagging, insights, news, ideas. Scout has its OWN OpenRouter key (separate quota — see the Scout card).",
    href: "https://openrouter.ai/activity",
  },
  {
    key: "ig_graph", label: "Instagram Graph API", tone: "info",
    rung: "IG sync · separate", limit: "~200 calls/user/hr",
    desc: "App-level rate limit (X-App-Usage headers). Live % tracking needs backend header-capture — not yet wired (follow-up).",
    href: "https://developers.facebook.com/apps/",
  },
];

function _daysBetween(a, b) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

// External-usage link: opens the provider's own usage page in a new tab.
// Falls back to plain text when no href is configured.
function ExtUsageLink({ href, children, style }) {
  if (!href) return <span style={style}>{children}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open usage on ${href.replace(/^https?:\/\//, "").split("/")[0]} ↗`}
      style={{
        color: "var(--c-cyan, #4fb6c8)", textDecoration: "none",
        borderBottom: "1px dotted currentColor", cursor: "pointer", ...style,
      }}
    >
      {children}<span style={{ fontSize: ".82em", opacity: 0.7 }}> ↗</span>
    </a>
  );
}

// Thin per-rung meter. `untracked` renders a hatched empty track (we can't read
// that provider's live usage from the browser) instead of a misleading fill.
function RungBar({ pct = 0, color, label, sub, untracked }) {
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 3 }}>
        <span className="mono dim" style={{ fontSize: 9 }}>{label}</span>
        {sub && (
          <span className="mono" style={{ fontSize: 9, color: untracked ? "var(--fg-faint, #888)" : color }}>{sub}</span>
        )}
      </div>
      <div style={{
        height: 6, borderRadius: 3, overflow: "hidden",
        background: "var(--border-dim, rgba(127,127,127,.16))",
        ...(untracked ? {
          backgroundImage: "repeating-linear-gradient(45deg, rgba(127,127,127,.04) 0, rgba(127,127,127,.04) 4px, rgba(127,127,127,.16) 4px, rgba(127,127,127,.16) 8px)",
        } : {}),
      }}>
        {!untracked && (
          <div style={{ width: `${Math.min(100, Math.max(0, pct))}%`, height: "100%", background: color }} />
        )}
      </div>
    </div>
  );
}

export function ProviderBudgetsCard({ onStats }) {
  const isOwner = useIsOwner();

  const credit = React.useMemo(() => {
    const now = new Date();
    const total = Math.max(1, _daysBetween(GCP_CREDIT.grantedOn, GCP_CREDIT.expiresOn));
    const left = Math.max(0, _daysBetween(now, GCP_CREDIT.expiresOn));
    const elapsedPct = Math.min(100, Math.max(0, Math.round(((total - left) / total) * 100)));
    const tone = left <= 7 ? "alert" : left <= 30 ? "warn" : "ok";
    return { total, left, elapsedPct, tone };
  }, []);

  React.useEffect(() => {
    onStats && onStats({ daysLeft: credit.left, tone: credit.tone });
  }, [credit, onStats]);

  if (!isOwner) return null;

  const barColor = credit.tone === "alert" ? "var(--c-red, #e0564f)"
    : credit.tone === "warn" ? "var(--c-amber, #e0a458)" : "var(--c-green, #5fb87a)";
  const expLabel = new Date(GCP_CREDIT.expiresOn).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });

  // Live-ish OpenRouter usage: today's MAIN-pool free-LLM calls from THIS browser
  // (Scout excluded — separate key). Plain localStorage read; no hook needed.
  const daily = loadDailyUsage();
  const mainFeatures = GATE_FEATURES.filter(f => f.key !== "scout");
  const OR_DAILY_CAP = 50;
  const orToday = mainFeatures.reduce((s, f) => s + (daily.counts[f.key] || 0), 0);
  const orPct = Math.min(100, Math.round((orToday / OR_DAILY_CAP) * 100));
  const orColor = orPct >= 90 ? "var(--c-red, #e0564f)"
    : orPct >= 70 ? "var(--c-amber, #e0a458)" : "var(--c-green, #5fb87a)";
  const orBreakdown = mainFeatures
    .map(f => ({ label: f.label, n: daily.counts[f.key] || 0, color: f.color }))
    .filter(x => x.n > 0)
    .sort((a, b) => b.n - a.n);

  return (
    <Card
      title="API Budgets & Limits"
      right={
        <span className="mono" style={{ fontSize: 11, color: barColor }}>
          {credit.left} days left
        </span>
      }
      footLeft="GCP day-countdown + OpenRouter today are live · Gemini/IG limits static"
    >
      <div className="mon-section-body">
        {/* $300 GCP credit — live countdown */}
        <div style={{
          marginBottom: 12, paddingBottom: 12,
          borderBottom: "1px solid var(--border-dim, rgba(127,127,127,.18))",
        }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 20, fontWeight: 700 }}>${GCP_CREDIT.amount}</span>
            <ExtUsageLink href={GCP_CREDIT.href} style={{ fontSize: 10 }}>
              <span className="mono">GCP free-trial credit</span>
            </ExtUsageLink>
            <span className="mono" style={{ fontSize: 11, marginLeft: "auto", color: barColor }}>
              {credit.left} / {credit.total} days
            </span>
          </div>
          {/* time-elapsed bar */}
          <div style={{
            height: 8, borderRadius: 4, overflow: "hidden",
            background: "var(--border-dim, rgba(127,127,127,.18))",
          }}>
            <div style={{ width: `${credit.elapsedPct}%`, height: "100%", background: barColor }} />
          </div>
          <div className="mono dim" style={{ fontSize: 10, marginTop: 6 }}>
            expires {expLabel} · {credit.elapsedPct}% of window elapsed · spend before expiry — unused credit is lost
          </div>
          <div className="mono dim" style={{ fontSize: 10, marginTop: 3 }}>
            applies to: {GCP_CREDIT.appliesTo}
          </div>
        </div>

        {/* Ladder rungs + IG Graph */}
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {PROVIDER_LIMITS.map(p => {
            const dot = p.tone === "warn" ? "var(--c-amber, #e0a458)"
              : p.tone === "credit" ? "var(--c-cyan, #4fb6c8)"
              : p.tone === "info" ? "var(--c-violet, #9b8cce)"
              : "var(--c-green, #5fb87a)";
            return (
              <div key={p.key} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                <span style={{
                  width: 9, height: 9, borderRadius: 2, background: dot,
                  flexShrink: 0, marginTop: 3,
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <ExtUsageLink href={p.href} style={{ fontSize: 12, fontWeight: 700 }}>
                      {p.label}
                    </ExtUsageLink>
                    <span className="mono dim" style={{ fontSize: 9 }}>{p.rung}</span>
                    <span className="mono" style={{ fontSize: 10, marginLeft: "auto", textAlign: "right" }}>
                      {p.limit}
                    </span>
                  </div>
                  <div className="mono dim" style={{ fontSize: 10, marginTop: 1 }}>{p.desc}</div>

                  {p.key === "gemini_api" && (
                    <RungBar untracked label="live usage — not tracked client-side" sub="see AI Studio ↗" />
                  )}
                  {p.key === "vertex_gemini" && (
                    <RungBar pct={credit.elapsedPct} color={barColor} label="$300 credit window" sub={`${credit.left}d left`} />
                  )}
                  {p.key === "openrouter" && (
                    <>
                      <RungBar pct={orPct} color={orColor} label="calls today · this browser" sub={`${orToday} / ~${OR_DAILY_CAP}`} />
                      <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 2 }}>
                        {orBreakdown.length === 0 ? (
                          <div className="mono dim" style={{ fontSize: 9 }}>no free-LLM calls yet today (this browser)</div>
                        ) : orBreakdown.map(b => (
                          <div key={b.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ width: 7, height: 7, borderRadius: 2, background: b.color, flexShrink: 0 }} />
                            <span className="mono dim" style={{ fontSize: 9.5, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.label}</span>
                            <span className="mono" style={{ fontSize: 9.5 }}>{b.n}</span>
                          </div>
                        ))}
                        <div className="mono dim" style={{ fontSize: 8.5, marginTop: 1, opacity: 0.85 }}>
                          turn unneeded ones off in Free LLM gates ↑ to reserve the 50/day for new features
                        </div>
                      </div>
                    </>
                  )}
                  {p.key === "ig_graph" && (
                    <RungBar untracked label="live usage — needs backend header capture" sub="see Meta ↗" />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mono dim" style={{ fontSize: 10, marginTop: 12 }}>
          OpenRouter bar = free-LLM calls from THIS browser today (resets 00:00 UTC) · Gemini / Vertex / IG live usage needs backend work — limits shown are maintained in-code
        </div>
      </div>
    </Card>
  );
}

// MapForge — quick-access launcher for the two static viewer pages hosted
// under /mapforge/ (built by the MapForge repo's scripts/build-static.mjs and
// dropped into public/mapforge/). Owner-only by riding the "monitor" gate.
function MapForgeLanding() {
  const links = [
    {
      href: "/mapforge/dashboard.html",
      title: "Owner Dashboard",
      desc: "Lead funnel, per-target status, sites built/hot, outreach + engagement — across every scrape job.",
      bg: "#23314f", fg: "#bcd0ff",
    },
    {
      href: "/mapforge/index.html",
      title: "Preview Gallery",
      desc: "Every generated demo site — Standard vs Premium build, side by side. Each carries the noindex + unofficial-demo watermark.",
      bg: "#3a2a4f", fg: "#e3c0ff",
    },
  ];
  return (
    <Card title="MapForge">
      <p style={{ color: "var(--fg-dim, #9aa3b2)", margin: "0 0 14px", maxWidth: 720 }}>
        Scrape-to-site engine. Open either viewer in a new tab.
      </p>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        {links.map((l) => (
          <a
            key={l.href}
            href={l.href}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "block", textDecoration: "none", flex: "1 1 280px", minWidth: 260,
              background: "var(--bg-2, #1a1d24)", border: "1px solid var(--line, #262a33)",
              borderRadius: 12, padding: "16px 18px",
            }}
          >
            <span
              style={{
                display: "inline-block", marginBottom: 8, padding: "4px 12px", borderRadius: 999,
                fontSize: 13, fontWeight: 700, background: l.bg, color: l.fg,
              }}
            >
              {l.title} ↗
            </span>
            <div style={{ color: "var(--fg-dim, #9aa3b2)", fontSize: 13, lineHeight: 1.5 }}>{l.desc}</div>
          </a>
        ))}
      </div>
    </Card>
  );
}

// view = the permission-catalog key each sub-view is gated by (preserved
// verbatim from when these were top-level tabs, so gating never changes).
// MapForge rides the "monitor" gate (owner-only, same as Infra).
const SUBVIEWS = [
  { key: "infra",    label: "Infra",    view: "monitor", Comp: Monitor },
  { key: "pulse",    label: "Pulse",    view: "pulse",   Comp: Pulse },
  { key: "ai",       label: "AI Brain", view: "ai",      Comp: AIBrain },
  { key: "scout",    label: "Scout",    view: "scout",   Comp: Scout },
  { key: "mapforge", label: "MapForge", view: "monitor", Comp: MapForgeLanding },
];

// Clamp any numeric to a 0..100 conic-gradient percentage.
function gaugePct(v) {
  if (v == null || !isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

export function MonitorHub({ canView }) {
  const allowed = useMemo(() => SUBVIEWS.filter(s => canView(s.view)), [canView]);

  const [mode, setMode] = useState(() => localStorage.getItem(MONITOR_MODE_KEY) || "infra");

  // Land on the first allowed sub-tab when the persisted one isn't currently
  // granted (a role with only Pulse must not land on a blank Infra screen).
  const activeKey = allowed.some(s => s.key === mode) ? mode : (allowed[0]?.key ?? null);

  useEffect(() => { if (activeKey && activeKey !== mode) setMode(activeKey); }, [activeKey, mode]);
  useEffect(() => { localStorage.setItem(MONITOR_MODE_KEY, mode); }, [mode]);

  if (allowed.length === 0) return null;   // defensive: hub only mounts when ≥1 granted

  const Active = (allowed.find(s => s.key === activeKey) || allowed[0]).Comp;

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

      {/* The 6 owner telemetry cards (frontend perf, editor usage, CapCut
          installs, storage, free-LLM gates, API budgets) now render INSIDE
          the Infra sub-view (monitor.jsx) as part of its unified sectioned
          layout — see Monitor(). MonitorHub is just the sub-tab shell now. */}

      {/* The mounted sub-view (infra Monitor / Pulse / AI Brain / Scout) —
          its own content only, exactly as each function rendered before. */}
      <div style={{ marginTop: 14 }}>
        <Active />
      </div>

      <style>{SOL_MONITOR_CSS}</style>
    </div>
  );
}
