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

function FrontendPerfCard() {
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

function EditorUsageCard() {
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

// view = the permission-catalog key each sub-view is gated by (preserved
// verbatim from when these were top-level tabs, so gating never changes).
const SUBVIEWS = [
  { key: "infra",  label: "Infra",    view: "monitor", Comp: Monitor },
  { key: "pulse",  label: "Pulse",    view: "pulse",   Comp: Pulse },
  { key: "ai",     label: "AI Brain", view: "ai",      Comp: AIBrain },
  { key: "scout",  label: "Scout",    view: "scout",   Comp: Scout },
];

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
    <div>
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
      {/* D5: owner-only frontend-performance card — self-gates via useIsOwner
          and renders above the active sub-view. The editor-usage tracker sits
          beside it (also owner-only, self-gated). */}
      <div style={{ padding: "12px 22px 0", display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
        <FrontendPerfCard />
        <EditorUsageCard />
      </div>
      <Active />
    </div>
  );
}
