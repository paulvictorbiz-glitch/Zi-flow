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
          and renders above the active sub-view. */}
      <div style={{ padding: "12px 22px 0" }}>
        <FrontendPerfCard />
      </div>
      <Active />
    </div>
  );
}
