/* =========================================================
   Monitor — infrastructure usage dashboard.
   Polls /api/monitor/status every 15 min and shows usage bars +
   sparklines for Supabase, Hetzner, and Google Cloud. Fires an
   in-app toast when any metric crosses 80%.
   Owner-only view.
   ========================================================= */

import React, { useState, useEffect, useCallback } from "react";
import "./monitor.css";
import { Card, DPill } from "../components/components.jsx";
import { supabase } from "../lib/supabase-client.js";
import { scoutSupabase } from "../lib/scout-supabase.js";
import { PLATFORMS, CONNECT_URLS, fetchConnections, runHealthChecks, deriveStatus, invalidateConnectionsCache } from "../lib/social-client.js";
import { useWorkflow } from "../store/store.jsx";
import { useRoster } from "../lib/roster.jsx";
import SpiderChart from "../components/SpiderChart.jsx";
import { MEDAL_TIERS } from "../lib/gamify-data.jsx";
import "../components/gamify.css";

/* Distinct overlay colors for the team spider chart (one per person). */
const GF_SERIES_COLORS = ["#6fd6ff", "#a99bff", "#5ad17a", "#f0c060", "#ff6f91", "#ff9f5a"];

const POLL_MS   = 60 * 60 * 1000;   // 60 min — these provider APIs are rate-limited
const WARN_PCT  = 80;
const CRIT_PCT  = 95;
const CACHE_KEY = "mon.cache.v1";   // last successful /api/monitor/status payload

/* The provider sub-fetches that make up a status payload. Each can fail
   independently (e.g. the Hetzner OS /api/metrics tick times out) without the
   others failing — so we merge per-section and keep the last-good value rather
   than letting one blip blank a whole card. */
const STATUS_SECTIONS = ["supabase", "hetzner", "gcp", "os", "worldMonitor"];

/* A section is "usable" (worth displaying / caching) when it actually carried
   data — i.e. it's configured and didn't report an error. An unconfigured or
   errored section is a failure/blip we'd rather replace with last-good. */
function sectionUsable(s) {
  return !!s && s.configured !== false && !s.error;
}

/* Merge a fresh payload over the previous one, preserving the last-good value
   for any section that came back unusable this tick (and flagging it _stale so
   the UI can show it's not live). This is what makes the OS donuts — and every
   other card — keep showing through a transient provider hiccup. */
function mergeStatus(prev, next) {
  if (!next) return prev;
  const merged = { ...next };
  for (const k of STATUS_SECTIONS) {
    if (!sectionUsable(next[k]) && sectionUsable(prev?.[k])) {
      merged[k] = { ...prev[k], _stale: true };
    }
  }
  return merged;
}

/* Strip the transient _stale flags before caching so a since-recovered section
   doesn't render as stale on the next cold mount. */
function stripStale(d) {
  if (!d) return d;
  const out = { ...d };
  for (const k of STATUS_SECTIONS) {
    if (out[k]?._stale) {
      const { _stale, ...rest } = out[k];
      out[k] = rest;
    }
  }
  return out;
}

/* ── helpers ─────────────────────────────────────────────── */
function pctTone(p) {
  if (p == null) return "ok";
  return p >= CRIT_PCT ? "red" : p >= WARN_PCT ? "amber" : "ok";
}

function fmtBytes(b) {
  if (b == null) return "—";
  if (b >= 1e9) return (b / 1e9).toFixed(1) + " GB";
  if (b >= 1e6) return (b / 1e6).toFixed(1) + " MB";
  if (b >= 1e3) return (b / 1e3).toFixed(1) + " KB";
  return b + " B";
}

function fmt(n) {
  if (n == null || isNaN(n)) return "—";
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return String(Math.round(n));
}

function relTime(iso) {
  if (!iso) return "";
  const diff = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return Math.round(diff / 60) + "m ago";
  if (diff < 86400) return Math.round(diff / 3600) + "h ago";
  return Math.round(diff / 86400) + "d ago";
}

/* ── UsageBar ────────────────────────────────────────────── */
function UsageBar({ label, pct: p, detail }) {
  const tone = pctTone(p);
  const filled = p != null ? Math.min(100, p) : 0;
  return (
    <div className="mon-bar">
      <div className="mon-bar-head">
        <span className="mon-bar-label">{label}</span>
        <span className={`mon-bar-pct mon-bar-pct--${tone}`}>
          {p != null ? p + "%" : "—"}
        </span>
      </div>
      <div className="mon-bar-track">
        <div
          className={`mon-bar-fill mon-bar-fill--${tone}`}
          style={{ width: filled + "%" }}
        />
      </div>
      {detail && <div className="mon-bar-detail">{detail}</div>}
    </div>
  );
}

/* ── Sparkline ───────────────────────────────────────────── */
function Sparkline({ values = [], color = "var(--c-cyan)", label }) {
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

/* ── StatRow ─────────────────────────────────────────────── */
function StatRow({ label, value, tone }) {
  return (
    <div className="mon-stat-row">
      <span className="mon-stat-k">{label}</span>
      <span className={`mon-stat-v${tone ? " mon-stat-v--" + tone : ""}`}>{value}</span>
    </div>
  );
}

/* ── StaleTag ────────────────────────────────────────────────
   Shown on a card when its section is rendering last-good data because the
   latest poll tick for that provider failed (kept visible instead of blanked). */
function StaleTag() {
  return (
    <span
      className="mon-stale-tag"
      title="The latest refresh for this card failed — showing the last known-good values."
    >
      ⚠ last good
    </span>
  );
}

/* ── News Monitor (Pulse) health ─────────────────────────────
   Reads the live Pulse slices from the store (no extra fetch): source
   health (enabled / errored / last fetched) + how many auto-ingested
   articles are stored. Poller rows auto-prune after 60 days, so the
   count stays bounded; we still warn if it climbs unusually high. */
function fmtAgo(iso) {
  if (!iso) return "never";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function NewsMonitorSection() {
  const { monitorSources, monitorEvents } = useWorkflow();
  const sources = Array.isArray(monitorSources) ? monitorSources : [];
  const events  = Array.isArray(monitorEvents) ? monitorEvents : [];

  const active   = sources.filter(s => s.enabled).length;
  const errored  = sources.filter(s => s.lastStatus && s.lastStatus !== "ok");
  const pollerN  = events.filter(e => e.sourceType === "poller").length;
  const lastIngest = sources.reduce((m, s) =>
    (s.lastFetchedAt && (!m || s.lastFetchedAt > m)) ? s.lastFetchedAt : m, null);
  // Bounded by the 60-day prune; flag if it climbs past a generous ceiling.
  const growthTone = pollerN > 5000 ? "amber" : "ok";

  return (
    <div className="mon-section-body">
      <div className="mon-stats-grid">
        <StatRow label="Active sources" value={`${active} / ${sources.length}`}
          tone={sources.length === 0 ? "amber" : "ok"} />
        <StatRow label="Articles stored" value={fmt(pollerN)} tone={growthTone} />
        <StatRow label="Last ingest" value={fmtAgo(lastIngest)} />
        <StatRow label="Feeds erroring" value={errored.length}
          tone={errored.length ? "red" : "ok"} />
      </div>
      {errored.length > 0 && (
        <div className="mon-hint" style={{ marginTop: 8, color: "var(--c-red, #ef4444)" }}>
          {errored.map(s => s.name).join(", ")} — check the feed URL in Pulse → Sources.
        </div>
      )}
      <div className="mon-hint" style={{ marginTop: 8 }}>
        Auto-ingested every 30 min · classified by free OpenRouter models (falls back to
        source defaults if throttled) · poller articles auto-prune after 60 days.
      </div>
    </div>
  );
}

/* ── World Monitor section ───────────────────────────────────
   Reads the live free-feed (USGS/FIRMS/ACLED) usage from
   /api/monitor/status (status.js fetchWorldMonitorStats → app_settings
   keys `world_monitor` + `world_monitor_usage`). Shows the FIRMS daily
   cap + ACLED usage bars, native event/ingest stats, and an owner kill
   switch on the embed + each free feed. Paid APIs (Finnhub/FRED/IMF/
   NASDAQ/flights) are rendered DISABLED — they stay off for now.

   Single-writer contract: this card is the ONLY writer of the
   `world_monitor` flags (the ingest engine owns `world_monitor_usage`).
   Writes go straight to app_settings via the "owner write app_settings"
   RLS policy (mirrors AnthropicSection) — no Vercel function burned. */
function WorldMonitorSection({ data }) {
  // Local copy of the flags so a toggle is optimistic; seeded from status.
  const [flags, setFlags] = useState(null);
  const [saving, setSaving] = useState(null); // which key is mid-write
  const [err, setErr]       = useState(null);

  // Seed/refresh local flag state whenever the status payload changes.
  useEffect(() => {
    if (!data || data.error || !data.configured) { setFlags(null); return; }
    setFlags({
      embedEnabled: data.embedEnabled !== false,
      free: {
        usgs:  data.free?.usgs  !== false,
        firms: data.free?.firms !== false,
        acled: data.free?.acled !== false,
      },
      paid: {
        finnhub: !!data.paid?.finnhub,
        fred:    !!data.paid?.fred,
        imf:     !!data.paid?.imf,
        nasdaq:  !!data.paid?.nasdaq,
        flights: !!data.paid?.flights,
      },
    });
  }, [data]);

  // Owner-gated write of the whole `world_monitor` flag object to
  // app_settings. `mutate` produces the next value from the current one.
  async function writeFlags(saveKey, mutate) {
    if (!flags || saving) return;
    const next = mutate(flags);
    setSaving(saveKey);
    setErr(null);
    setFlags(next); // optimistic
    try {
      const { error } = await supabase
        .from("app_settings")
        .upsert(
          {
            key: "world_monitor",
            value: { embed_enabled: next.embedEnabled, free: next.free, paid: next.paid },
            updated_at: new Date().toISOString(),
          },
          { onConflict: "key" }
        );
      if (error) throw error;
    } catch (e) {
      setFlags(flags); // revert on failure
      setErr(e.message || "Save failed — owner access required");
    } finally {
      setSaving(null);
    }
  }

  if (!data) return <div className="mon-loading">Loading…</div>;
  if (data.error) return <div className="mon-error">{data.error}</div>;
  if (!data.configured) return (
    <div className="mon-unconfigured">
      Add <code>SUPABASE_URL</code> + <code>SUPABASE_SERVICE_ROLE_KEY</code> to Vercel env vars,
      then run migration <code>0066_world_monitor_settings.sql</code> to seed the feed flags.
    </div>
  );

  const embedOk   = data.embedOk !== false;
  const embedTone = !flags?.embedEnabled ? "amber" : embedOk ? "ok" : "red";
  const PAID = [
    ["finnhub", "Finnhub"],
    ["fred",    "FRED"],
    ["imf",     "IMF"],
    ["nasdaq",  "NASDAQ"],
    ["flights", "Flight tracker"],
  ];

  return (
    <div className="mon-section-body">
      <div className="mon-hint" style={{ marginBottom: 10 }}>
        Free world feeds ingested natively into Pulse (USGS quakes, NASA FIRMS
        fires, ACLED conflict). The public worldmonitor.app dashboard is embedded
        read-only in Pulse → World. Paid APIs stay off.
      </div>

      <UsageBar
        label={`FIRMS — ${fmt(data.firmsDailyUsed).replace("—","0")} / ${fmt(data.firmsDailyLimit)} map keys today`}
        pct={data.firmsDailyPct ?? 0}
      />
      {data.acledLimit > 0 ? (
        <UsageBar
          label={`ACLED — ${fmt(data.acledUsed).replace("—","0")} / ${fmt(data.acledLimit)} this period`}
          pct={data.acledPct ?? 0}
        />
      ) : (
        <StatRow label="ACLED calls" value={fmt(data.acledUsed).replace("—","0")} tone="ok" />
      )}

      <div className="mon-stats-grid" style={{ marginTop: 8 }}>
        <StatRow label="USGS events stored" value={fmt(data.usgsCount).replace("—","0")} tone="ok" />
        <StatRow label="Last ingest" value={fmtAgo(data.lastIngestAt)} />
        <StatRow
          label="Embed health"
          value={!flags?.embedEnabled ? "disabled" : embedOk ? "reachable" : "blocked"}
          tone={embedTone}
        />
      </div>

      {/* Embed kill switch */}
      <div className="mon-killrow">
        <div className="mon-killrow-text">
          <div className="mon-killrow-title">World embed</div>
          <div className="mon-killrow-sub">
            {flags == null
              ? "Checking…"
              : flags.embedEnabled
                ? "Active — Pulse → World shows the worldmonitor.app embed"
                : "Hidden — the World view embed is turned off"}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={!!flags?.embedEnabled}
          disabled={flags == null || saving === "embed"}
          onClick={() => writeFlags("embed", f => ({ ...f, embedEnabled: !f.embedEnabled }))}
          className={`mon-switch${flags?.embedEnabled ? " mon-switch--on" : ""}`}
          title={flags?.embedEnabled ? "Click to hide the World embed" : "Click to show the World embed"}
        >
          <span className="mon-switch-knob" />
        </button>
      </div>

      {/* Free-feed toggles */}
      <div className="mon-table-label" style={{ marginTop: 12 }}>Free feeds</div>
      {[
        ["usgs",  "USGS earthquakes"],
        ["firms", "NASA FIRMS fires"],
        ["acled", "ACLED conflict"],
      ].map(([key, label]) => {
        const on = !!flags?.free?.[key];
        return (
          <div key={key} className="mon-killrow">
            <div className="mon-killrow-text">
              <div className="mon-killrow-title">{label}</div>
              <div className="mon-killrow-sub">
                {flags == null ? "Checking…" : on ? "Ingesting on each run" : "Skipped — feed disabled"}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={on}
              disabled={flags == null || saving === `free.${key}`}
              onClick={() => writeFlags(`free.${key}`, f => ({
                ...f, free: { ...f.free, [key]: !f.free[key] },
              }))}
              className={`mon-switch${on ? " mon-switch--on" : ""}`}
              title={on ? `Click to stop ingesting ${label}` : `Click to ingest ${label}`}
            >
              <span className="mon-switch-knob" />
            </button>
          </div>
        );
      })}

      {err && <div className="mon-killrow-err">{err}</div>}

      {/* Paid APIs — off for now, rendered disabled */}
      <div className="mon-table-label" style={{ marginTop: 12 }}>Paid APIs</div>
      {PAID.map(([key, label]) => (
        <div key={key} className="mon-killrow">
          <div className="mon-killrow-text">
            <div className="mon-killrow-title">{label}</div>
            <div className="mon-killrow-sub">off — enable later</div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={false}
            disabled
            className="mon-switch"
            title="Paid API — disabled for now"
          >
            <span className="mon-switch-knob" />
          </button>
        </div>
      ))}
    </div>
  );
}

/* ── Toast ───────────────────────────────────────────────── */
function Toast({ msg, onDismiss }) {
  if (!msg) return null;
  return (
    <div className="mon-toast">
      <span className="mon-toast-icon">⚠</span>
      <span>{msg}</span>
      <button className="mon-toast-close" onClick={onDismiss}>×</button>
    </div>
  );
}

/* ── Supabase section ────────────────────────────────────── */
function SupabaseSection({ data }) {
  if (!data) return <div className="mon-loading">Loading…</div>;
  if (data.error) return <div className="mon-error">{data.error}</div>;
  if (!data.configured) return (
    <div className="mon-unconfigured">
      Add <code>SUPABASE_URL</code> + <code>SUPABASE_SERVICE_ROLE_KEY</code> to Vercel env vars.
    </div>
  );

  const rowPct = data.rowPct ?? 0;
  const topTables = data.rows
    ? Object.entries(data.rows)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
    : [];

  return (
    <div className="mon-section-body">
      <UsageBar
        label={`Total rows — ${fmt(data.totalRows)} / ${fmt(data.rowLimit)}`}
        pct={rowPct}
      />

      {data.storage && (
        <div className="mon-bars-group">
          <UsageBar
            label={`Database — ${fmtBytes(data.storage.dbBytes)} / ${fmtBytes(data.storage.dbBytesLimit)}`}
            pct={data.storage.dbPct}
          />
          <UsageBar
            label={`File storage — ${fmtBytes(data.storage.fileBytes)} / ${fmtBytes(data.storage.fileBytesLimit)}`}
            pct={data.storage.filePct}
          />
        </div>
      )}

      {data.mau != null && (
        <StatRow label="Monthly active users (30d)" value={fmt(data.mau)} />
      )}

      {!data.storage && (
        <div className="mon-hint">
          Add <code>SUPABASE_MANAGEMENT_TOKEN</code> + <code>SUPABASE_PROJECT_REF</code> for database size, storage, and MAU.
        </div>
      )}

      {data.storage && (
        <div className="mon-hint">
          Egress &amp; realtime-message totals live on Supabase's billing API,
          which only a dashboard session can read — see them on the{" "}
          <a href="https://supabase.com/dashboard/project/_/settings/billing/usage"
             target="_blank" rel="noreferrer" style={{ color: "var(--c-cyan)" }}>
            Supabase usage page
          </a>.
        </div>
      )}

      <div className="mon-table-label">Row counts by table</div>
      {topTables.map(([t, n]) => (
        <StatRow key={t} label={t} value={fmt(n)} />
      ))}

      <MigrationCheck />
    </div>
  );
}

/* ── Migration health check ──────────────────────────────── */
function MigrationCheck() {
  const [state, setState]   = React.useState("idle"); // idle | loading | done | error
  const [report, setReport] = React.useState(null);
  const [err, setErr]       = React.useState(null);

  const run = async () => {
    setState("loading"); setReport(null); setErr(null);
    try {
      const r = await fetch("/api/monitor/status?action=migrations");
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setReport(d);
      setState("done");
    } catch (e) {
      setErr(e.message);
      setState("error");
    }
  };

  return (
    <div className="mon-migcheck">
      <button className="mon-migcheck-btn" onClick={run} disabled={state === "loading"}>
        {state === "loading" ? "Checking migrations…" : "Check migrations"}
      </button>

      {state === "error" && (
        <div className="mon-migcheck-log mon-migcheck-log--err">
          ✗ Check failed: {err}
        </div>
      )}

      {state === "done" && report && (
        <div className={"mon-migcheck-log " + (report.ok ? "mon-migcheck-log--ok" : "mon-migcheck-log--warn")}>
          {report.error ? (
            <div>✗ {report.error}</div>
          ) : report.ok ? (
            <div>
              ✓ All {report.counts.expected} migrations match the database.
              <span className="mon-migcheck-sub"> ({report.counts.applied} applied, 0 issues)</span>
            </div>
          ) : (
            <div>
              <div className="mon-migcheck-head">
                ⚠ {report.counts.missing + report.counts.changed + report.counts.orphaned} issue(s) found —
                copy this and take it to Claude Code.
              </div>
              {report.missing.length > 0 && (
                <div className="mon-migcheck-block">
                  <strong>Missing in DB (never applied):</strong>
                  {report.missing.map((v) => <div key={v} className="mon-migcheck-item">• {v}</div>)}
                  <div className="mon-migcheck-fix">→ Fix: run <code>npm run migrate:apply</code> (or apply the SQL in Supabase).</div>
                </div>
              )}
              {report.changed.length > 0 && (
                <div className="mon-migcheck-block">
                  <strong>Edited after apply (checksum changed):</strong>
                  {report.changed.map((v) => <div key={v} className="mon-migcheck-item">• {v}</div>)}
                  <div className="mon-migcheck-fix">→ Fix: don't edit applied migrations — add a new one instead.</div>
                </div>
              )}
              {report.orphaned.length > 0 && (
                <div className="mon-migcheck-block">
                  <strong>In DB but missing from codebase:</strong>
                  {report.orphaned.map((v) => <div key={v} className="mon-migcheck-item">• {v}</div>)}
                  <div className="mon-migcheck-fix">→ Fix: the .sql file may have been deleted, or the manifest is stale (<code>npm run migrate:manifest</code>).</div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Hetzner section ─────────────────────────────────────── */
function HetznerSection({ data }) {
  if (!data) return <div className="mon-loading">Loading…</div>;
  if (data.error) return <div className="mon-error">{data.error}</div>;
  if (!data.configured) return (
    <div className="mon-unconfigured">
      Add <code>HETZNER_API_TOKEN</code> + <code>HETZNER_SERVER_ID</code> to Vercel env vars.
    </div>
  );

  // Build sparkline from cpu timeseries if available.
  const cpuSeries = data.timeseries?.["cpu"]?.values?.map(([, v]) => v) || [];

  // Bandwidth outgoing sparkline from timeseries (bytes/s → just use raw for shape).
  const bwSeries  = data.timeseries?.["network.0.bandwidth.out"]?.values?.map(([, v]) => v) || [];

  const statusTone = data.status === "running" ? "ok"
    : data.status === "off" ? "red" : "amber";

  return (
    <div className="mon-section-body">
      <div className="mon-server-head">
        <span className={`mon-status-dot mon-status-dot--${statusTone}`} />
        <span className="mon-server-name">{data.name}</span>
        <span className="mon-server-type">{data.type}</span>
        <span className={`mon-server-status mon-server-status--${statusTone}`}>{data.status}</span>
      </div>

      {data.bwPct != null && (
        <UsageBar
          label={`Bandwidth this month — ${fmtBytes(data.outgoing)} / ${fmtBytes(data.bwLimit)}`}
          pct={data.bwPct}
        />
      )}

      {cpuSeries.length > 1 && (
        <Sparkline values={cpuSeries} color="var(--c-cyan)" label="CPU % — 7-day" />
      )}
      {bwSeries.length > 1 && (
        <Sparkline values={bwSeries} color="#f5a524" label="Outgoing bandwidth — 7-day" />
      )}

      <div className="mon-stats-grid">
        <StatRow label="Location"      value={data.location || "—"} />
        <StatRow label="CPU cores"     value={data.cores ?? "—"} />
        <StatRow label="RAM"           value={data.ramGb ? data.ramGb + " GB" : "—"} />
        <StatRow label="Disk"          value={data.diskGb ? data.diskGb + " GB" : "—"} />
        <StatRow label="Incoming"      value={fmtBytes(data.incoming)} />
        <StatRow label="Outgoing"      value={fmtBytes(data.outgoing)} />
      </div>

      <a
        href="https://console.hetzner.com"
        target="_blank"
        rel="noreferrer"
        className="mon-vercel-link"
        style={{ marginTop: 12 }}
      >
        Open Hetzner Console ↗
      </a>
    </div>
  );
}

/* ── MemDonut ─────────────────────────────────────────────── */
const CONTAINER_COLORS = [
  "#22c55e", "#06b6d4", "#f5a524", "#a78bfa", "#f472b6",
  "#34d399", "#38bdf8", "#fb923c", "#c084fc", "#e879f9",
];

function MemDonut({ containers = [], totalGb }) {
  const totalMb = (totalGb || 0) * 1000;
  // Build slices: each container + an "other/OS" remainder
  const containerTotal = containers.reduce((s, c) => s + (c.memMb || 0), 0);
  const otherMb = Math.max(0, totalMb - containerTotal);

  const slices = [
    ...containers.map((c, i) => ({
      label: c.name.replace(/^fb-/, ""),
      mb: c.memMb,
      color: CONTAINER_COLORS[i % CONTAINER_COLORS.length],
    })),
    { label: "OS / other", mb: otherMb, color: "var(--bg-3)" },
  ].filter(s => s.mb > 0);

  // SVG donut: cx=60,cy=60,r=44,stroke-width=14
  const cx = 60, cy = 60, r = 44, strokeW = 14;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  const segments = slices.map(s => {
    const dash = (s.mb / totalMb) * circ;
    const seg = { ...s, dash, offset };
    offset += dash;
    return seg;
  });

  return (
    <div className="mon-mem-donut-wrap">
      <svg className="mon-mem-donut" viewBox="0 0 120 120">
        {segments.map((seg, i) => (
          <circle key={i}
            cx={cx} cy={cy} r={r}
            fill="none"
            stroke={seg.color}
            strokeWidth={strokeW}
            strokeDasharray={`${seg.dash} ${circ - seg.dash}`}
            strokeDashoffset={-seg.offset + circ / 4}
          />
        ))}
        <text x={cx} y={cy - 6} textAnchor="middle" className="mon-donut-val">
          {totalGb ? (containerTotal / 1000).toFixed(1) : "—"}
        </text>
        <text x={cx} y={cy + 10} textAnchor="middle" className="mon-donut-sub">GB used</text>
      </svg>
      <div className="mon-mem-legend">
        {slices.filter(s => s.label !== "OS / other").map((s, i) => (
          <div key={i} className="mon-mem-legend-row">
            <span className="mon-mem-legend-dot" style={{ background: s.color }} />
            <span className="mon-mem-legend-name">{s.label}</span>
            <span className="mon-mem-legend-val">{s.mb >= 1000 ? (s.mb/1000).toFixed(2)+" GB" : s.mb.toFixed(0)+" MB"}</span>
          </div>
        ))}
        <div className="mon-mem-legend-row mon-mem-legend-row--other">
          <span className="mon-mem-legend-dot" style={{ background: "var(--bg-3)", border: "1px solid var(--line-hard)" }} />
          <span className="mon-mem-legend-name">OS / other</span>
          <span className="mon-mem-legend-val">{otherMb >= 1000 ? (otherMb/1000).toFixed(2)+" GB" : otherMb.toFixed(0)+" MB"}</span>
        </div>
      </div>
    </div>
  );
}

/* ── DiskDonut ────────────────────────────────────────────── */
// Fixed palette keyed by category so colours stay stable across refreshes.
const DISK_COLORS = {
  "Container images": "#06b6d4",
  "Docker data":      "#22c55e",
  "App data (/srv)":  "#a78bfa",
  "Swapfile":         "#f5a524",
  "System (/usr)":    "#38bdf8",
  "Logs (/var/log)":  "#f472b6",
};
const DISK_OTHER_LABEL = "Other / system";

function DiskDonut({ breakdown = [], totalGb, usedGb }) {
  // Backend already appends an "Other / system" remainder, so slices sum to used.
  const slices = breakdown
    .filter(s => (s.gb || 0) > 0)
    .map(s => ({
      label: s.label,
      gb: s.gb,
      color: s.label === DISK_OTHER_LABEL ? "var(--bg-3)" : (DISK_COLORS[s.label] || "var(--bg-3)"),
    }));

  const sliceTotal = slices.reduce((s, x) => s + x.gb, 0);
  // Draw against actual used space (matches the centre label).
  const denom = usedGb || sliceTotal || 1;

  const cx = 60, cy = 60, r = 44, strokeW = 14;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  const segments = slices.map(s => {
    const dash = (s.gb / denom) * circ;
    const seg = { ...s, dash, offset };
    offset += dash;
    return seg;
  });

  const fmtGb = gb => gb >= 1 ? gb.toFixed(2) + " GB" : (gb * 1000).toFixed(0) + " MB";

  return (
    <div className="mon-mem-donut-wrap">
      <svg className="mon-mem-donut" viewBox="0 0 120 120">
        {segments.map((seg, i) => (
          <circle key={i}
            cx={cx} cy={cy} r={r}
            fill="none"
            stroke={seg.color}
            strokeWidth={strokeW}
            strokeDasharray={`${seg.dash} ${circ - seg.dash}`}
            strokeDashoffset={-seg.offset + circ / 4}
          />
        ))}
        <text x={cx} y={cy - 6} textAnchor="middle" className="mon-donut-val">
          {usedGb != null ? usedGb.toFixed(1) : "—"}
        </text>
        <text x={cx} y={cy + 10} textAnchor="middle" className="mon-donut-sub">
          {totalGb ? `/ ${Math.round(totalGb)} GB` : "GB used"}
        </text>
      </svg>
      <div className="mon-mem-legend">
        {slices.map((s, i) => (
          <div key={i} className={"mon-mem-legend-row" + (s.label === DISK_OTHER_LABEL ? " mon-mem-legend-row--other" : "")}>
            <span className="mon-mem-legend-dot" style={s.label === DISK_OTHER_LABEL
              ? { background: "var(--bg-3)", border: "1px solid var(--line-hard)" }
              : { background: s.color }} />
            <span className="mon-mem-legend-name">{s.label}</span>
            <span className="mon-mem-legend-val">{fmtGb(s.gb)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── OS metrics section ──────────────────────────────────── */
function OsSection({ data }) {
  if (!data) return <div className="mon-loading">Loading…</div>;
  if (!data.configured) return (
    <div className="mon-unconfigured">
      OS metrics are fetched from the Hetzner backend (<code>/api/metrics</code>).
      They appear once the backend is reachable.
    </div>
  );

  const loadTone = data.load1 > 3 ? "red" : data.load1 > 1.5 ? "amber" : "ok";
  const hasContainers = Array.isArray(data.containers) && data.containers.length > 0;
  const hasDiskBreakdown = Array.isArray(data.diskBreakdown) && data.diskBreakdown.length > 0;

  return (
    <div className="mon-section-body">
      {hasContainers && (
        <>
          <div className="mon-donut-label">Memory by container</div>
          <MemDonut containers={data.containers} totalGb={data.memTotalGb} />
        </>
      )}
      {hasDiskBreakdown && (
        <>
          <div className="mon-donut-label">Disk by category</div>
          <DiskDonut
            breakdown={data.diskBreakdown}
            totalGb={data.diskTotalGb}
            usedGb={data.diskUsedGb}
          />
        </>
      )}
      <div className="mon-bars-group">
        <UsageBar
          label="Memory"
          pct={data.memPct}
          detail={`${data.memUsedGb} / ${data.memTotalGb} GB`}
        />
        <UsageBar
          label="Swap"
          pct={data.swapPct}
          detail={`${data.swapUsedGb} / ${data.swapTotalGb} GB`}
        />
        <UsageBar
          label="Disk (/)"
          pct={data.diskPct}
          detail={`${data.diskUsedGb} / ${data.diskTotalGb} GB`}
        />
      </div>
      <div className="mon-stats-grid">
        <StatRow
          label="Load avg (1m / 5m / 15m)"
          value={`${data.load1} / ${data.load5} / ${data.load15}`}
          tone={loadTone}
        />
        <StatRow label="Processes" value={data.processes ?? "—"} />
      </div>
    </div>
  );
}

/* ── Google Cloud section ────────────────────────────────── */
function GcpSection({ data }) {
  if (!data) return <div className="mon-loading">Loading…</div>;
  if (data.error) return <div className="mon-error">{data.error}</div>;
  if (!data.configured) return (
    <div className="mon-unconfigured">
      Add <code>GOOGLE_CLOUD_PROJECT_ID</code> + <code>GOOGLE_SERVICE_ACCOUNT_JSON</code> to Vercel env vars.
    </div>
  );

  const yt = data.youtube;
  const maps = data.maps;

  return (
    <div className="mon-section-body">
      {data.billingCost != null && (
        <StatRow
          label="Current month spend"
          value={`$${data.billingCost.toFixed(2)} USD`}
          tone={data.billingCost > 10 ? "amber" : "ok"}
        />
      )}
      {data.billingCost == null && !data.billingConfigured && (
        <div className="mon-hint">
          Add <code>GCP_BILLING_ACCOUNT_ID</code> to Vercel env for billing cost.
        </div>
      )}
      {data.billingCost == null && data.billingConfigured && (
        <div className="mon-hint">
          No billing cost reported yet (free trial / under credit). Needs Billing Account Viewer + billed spend this month.
        </div>
      )}
      {yt && (
        <>
          <UsageBar
            label={`YouTube Data API quota — ${fmt(yt.quotaUsed).replace("—","0")} / ${fmt(yt.quotaLimit)} units today`}
            pct={yt.quotaPct}
          />
          <StatRow label="YT requests (7d)" value={yt.requests7d > 0 ? fmt(yt.requests7d) : "0"} tone="ok" />
          <div className="mon-hint">
            10,000 units/day free. Search = 100 units; list = 1 unit.
          </div>
        </>
      )}
      {maps && (
        <>
          <UsageBar
            label={`Maps JS API — ${fmt(maps.quotaUsed).replace("—","0")} / ${fmt(maps.quotaLimit)} loads today`}
            pct={maps.quotaPct}
          />
          {maps.rpm && (
            <>
              <UsageBar
                label={`Maps — peak ${fmt(maps.rpm.maps.peak)} / ${fmt(maps.rpm.maps.limit)} req/min`}
                pct={maps.rpm.maps.pct}
                detail={`${maps.requests7d > 0 ? fmt(maps.requests7d) : "0"} requests in last 7d`}
              />
              <UsageBar
                label={`Places — peak ${fmt(maps.rpm.places.peak)} / ${fmt(maps.rpm.places.limit)} req/min`}
                pct={maps.rpm.places.pct}
                detail={`${maps.places7d > 0 ? fmt(maps.places7d) : "0"} requests in last 7d`}
              />
              <UsageBar
                label={`Geocoding — peak ${fmt(maps.rpm.geocoding.peak)} / ${fmt(maps.rpm.geocoding.limit)} req/min`}
                pct={maps.rpm.geocoding.pct}
                detail={`${maps.geocoding7d > 0 ? fmt(maps.geocoding7d) : "0"} requests in last 7d`}
              />
            </>
          )}
          <div className="mon-hint">
            $200/mo free credit ≈ 28k map loads/mo. Per-minute limits are fixed by Google (not adjustable); use the $5 budget alert to cap spend.
          </div>
        </>
      )}
      {data.projectId && (
        <StatRow label="GCP project" value={data.projectId} tone="ok" />
      )}
    </div>
  );
}

/* ── Social token helpers ────────────────────────────────── */
function daysUntil(isoStr) {
  if (!isoStr) return null;
  return Math.ceil((new Date(isoStr).getTime() - Date.now()) / 86400000);
}

function expiryTone(days) {
  if (days === null) return "ok";
  if (days > 14) return "ok";
  if (days > 7) return "amber";
  return "red";
}

function fmtExpiry(expiresAt, tokenKind) {
  if (tokenKind === "page" || !expiresAt) return "Never (Page token)";
  const days = daysUntil(expiresAt);
  const dateStr = expiresAt.slice(0, 10);
  if (days === null) return dateStr;
  if (days < 0) return `${dateStr} (expired ${Math.abs(days)}d ago)`;
  return `${dateStr} (${days}d)`;
}

/* ── SocialTokenSection ──────────────────────────────────── */
function SocialTokenSection() {
  const [conns, setConns] = useState([]);
  const [checking, setChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState(null);

  const reload = useCallback(() => {
    fetchConnections(supabase).then(rows => { if (rows) setConns(rows); });
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const handleRefresh = useCallback(async () => {
    setChecking(true);
    try {
      const updated = await runHealthChecks(supabase);
      if (updated) setConns(updated);
    } finally {
      setChecking(false);
      setLastChecked(new Date());
    }
  }, []);

  const handleReconnect = useCallback((platform) => {
    const url = CONNECT_URLS[platform];
    if (!url) return;
    const popup = window.open(url, "_blank", "width=520,height=640");
    const handler = (e) => {
      if (e.data?.type === "oauth_complete" && e.data?.platform === platform) {
        window.removeEventListener("message", handler);
        popup?.close();
        invalidateConnectionsCache();
        reload();
      }
    };
    window.addEventListener("message", handler);
  }, [reload]);

  return (
    <div className="mon-social-wrap">
      <div className="mon-social-header-row">
        <div className="mon-social-col-labels">
          <span>Platform</span>
          <span>Status</span>
          <span>Token expiry</span>
          <span>Last checked</span>
          <span></span>
        </div>
        <div className="mon-social-actions">
          {checking && <span className="mono muted" style={{ fontSize: 11 }}>Checking…</span>}
          {lastChecked && !checking && (
            <span className="mono muted" style={{ fontSize: 11 }}>
              Last run {relTime(lastChecked.toISOString())}
            </span>
          )}
          <DPill onClick={handleRefresh} disabled={checking}>Refresh now</DPill>
        </div>
      </div>
      {PLATFORMS.map(p => {
        const conn = conns.find(c => c.platform === p.key) || { platform: p.key, connected: false, tokenKind: null };
        const status = deriveStatus(conn);
        const days = conn.expiresAt ? daysUntil(conn.expiresAt) : null;
        const tone = conn.connected ? expiryTone(days) : "red";
        const statusTone = status === "connected" ? "ok" : status === "expiring" ? "amber" : "red";
        const needsAction = status === "error" || status === "expiring" || status === "disconnected";
        return (
          <div key={p.key} className="mon-social-row">
            <div className="mon-social-platform">
              <span className="mon-social-glyph" style={{ background: p.color }}>{p.glyph}</span>
              <div className="mon-social-info">
                <span className="mon-social-name">{p.label}</span>
                {conn.handle && <span className="mon-social-handle">{conn.handle}</span>}
              </div>
            </div>
            <div className="mon-social-status">
              <span className={`mon-status-dot mon-status-dot--${statusTone}`} />
              <span className={`mon-stat-v mon-stat-v--${statusTone}`}>{status}</span>
            </div>
            <div className={`mon-social-expiry mon-stat-v--${tone}`}>
              {conn.connected ? fmtExpiry(conn.expiresAt, conn.tokenKind) : "—"}
            </div>
            <div className="mon-social-checked mono dim">
              {conn.lastCheckedAt ? relTime(conn.lastCheckedAt) : "never"}
            </div>
            <div>
              {needsAction && CONNECT_URLS[p.key] && (
                <button className="mon-reconnect-btn" onClick={() => handleReconnect(p.key)}>
                  {status === "disconnected" ? "Connect" : "Reconnect"}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── AI Credits section ──────────────────────────────────── */
/* ── AnthropicSection — Claude usage link + owner kill switch ─────────────────
   Anthropic exposes no usage/rate-limit API, so we link out to the Console
   dashboard (like the Vercel card) and add a sliding toggle that pauses all
   server-side Claude calls (generate.js, ai/ask.js, ai/suggest.js) by flipping
   the `anthropic_enabled` flag in app_settings. */
function AnthropicSection() {
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState(null);

  // Read current flag (any authed user can SELECT app_settings via RLS).
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "anthropic_enabled")
        .maybeSingle();
      if (!alive) return;
      setEnabled(data?.value?.enabled !== false);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  async function toggle() {
    if (saving) return;
    const next = !enabled;
    setSaving(true);
    setErr(null);
    setEnabled(next); // optimistic
    try {
      // Write the flag straight to app_settings. The "owner write app_settings"
      // RLS policy (migration 0014) restricts this upsert to owners, so no
      // server endpoint is needed — and we don't burn a Vercel function slot.
      const { error } = await supabase
        .from("app_settings")
        .upsert(
          { key: "anthropic_enabled", value: { enabled: next }, updated_at: new Date().toISOString() },
          { onConflict: "key" }
        );
      if (error) throw error;
    } catch (e) {
      setEnabled(!next); // revert on failure
      setErr(e.message || "Save failed — owner access required");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mon-section-body">
      <div className="mon-hint" style={{ marginBottom: 10 }}>
        Anthropic does not expose usage or rate-limit metrics via API — token
        spend, request counts, and rate-limit headroom are only visible in the
        Console dashboard.
      </div>
      <a
        href="https://platform.claude.com/dashboard"
        target="_blank"
        rel="noreferrer"
        className="mon-vercel-link"
      >
        Open Claude usage dashboard ↗
      </a>

      {/* Kill switch */}
      <div className="mon-killrow">
        <div className="mon-killrow-text">
          <div className="mon-killrow-title">Claude API</div>
          <div className="mon-killrow-sub">
            {loading
              ? "Checking…"
              : enabled
                ? "Active — Generate, AI Brain & FAQ bot can call Claude"
                : "Paused — AI features that use Claude are disabled"}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          disabled={loading || saving}
          onClick={toggle}
          className={`mon-switch${enabled ? " mon-switch--on" : ""}`}
          title={enabled ? "Click to pause Claude usage" : "Click to re-enable Claude"}
        >
          <span className="mon-switch-knob" />
        </button>
      </div>
      {err && <div className="mon-killrow-err">{err}</div>}

      <div className="mon-stats-grid" style={{ marginTop: 14 }}>
        <StatRow label="Model" value="claude-sonnet-4-6" />
        <StatRow label="Used by" value="Generate · AI Brain · FAQ bot" />
        <StatRow label="Status" value={loading ? "—" : enabled ? "Active" : "Paused"} />
      </div>
    </div>
  );
}

/* ── GamifySection — owner toggles + team overlay chart + leaderboard ─────────
   Two toggles persisted to app_settings (via the store actions, which mirror
   the anthropic kill-switch RLS-write pattern). The team spider chart overlays
   every person's scores; the leaderboard ranks by total XP. */
function GfSwitch({ on, onToggle, label, disabled }) {
  return (
    <button type="button" className="gf-switch" onClick={onToggle} disabled={disabled}
            role="switch" aria-checked={on}>
      <span className={`gf-switch-track${on ? " on" : ""}`}><span className="gf-switch-knob" /></span>
      <span>{label}</span>
    </button>
  );
}

const DESC_MODE_LABEL = { off: "Off", "active-only": "Active", all: "All" };
const DESC_MODE_NEXT  = { off: "active-only", "active-only": "all", all: "off" };
const DESC_MODE_SUB   = {
  off:           "Hidden — rubric shows sub-skill names and the checklist only",
  "active-only": "Active grade — descriptions sit under each column; once graded, only the chosen band stays",
  all:           "All three — every band's description sits under its column; the active one highlighted",
};

function GamifySection() {
  const { gamifyEnabled, gamifyGradingMode, rubricDescMode, gamifyProgress, actions } = useWorkflow();
  const { setGamifyEnabled, setGamifyGradingMode, setRubricDescMode } = actions;
  const { peopleList } = useRoster();

  // People who have any gamify progress, joined with their roster name.
  const rows = (peopleList || [])
    .map((p, i) => {
      const prog = gamifyProgress.find(g => g.personId === p.id);
      return {
        id: p.id, name: p.name || p.id,
        totalXp: prog?.totalXp || 0,
        medal: prog?.medal || "none",
        scores: prog?.skillScores || {},
        color: GF_SERIES_COLORS[i % GF_SERIES_COLORS.length],
      };
    })
    .sort((a, b) => b.totalXp - a.totalXp);

  const series = rows
    .filter(r => Object.keys(r.scores).length)
    .map(r => ({ label: r.name, color: r.color, scores: r.scores }));

  const editorReviewer = gamifyGradingMode !== "reviewer_only";

  return (
    <div className="mon-section-body">
      <div className="mon-hint" style={{ marginBottom: 12 }}>
        Turn skill development into a game: XP, spider charts, medals, and rubric
        grading. Toggle off if it gets in the way.
      </div>

      {/* Toggle 1 — master on/off */}
      <div className="mon-killrow">
        <div className="mon-killrow-text">
          <div className="mon-killrow-title">Gamify system</div>
          <div className="mon-killrow-sub">
            {gamifyEnabled
              ? "Active — popup, spider charts & rubric grading are live"
              : "Disabled — all gamify UI is hidden across the app"}
          </div>
        </div>
        <GfSwitch on={gamifyEnabled} onToggle={() => setGamifyEnabled(!gamifyEnabled)}
                  label={gamifyEnabled ? "On" : "Off"} />
      </div>

      {/* Toggle 2 — grading mode */}
      <div className="mon-killrow">
        <div className="mon-killrow-text">
          <div className="mon-killrow-title">Grading mode</div>
          <div className="mon-killrow-sub">
            {editorReviewer
              ? "Editor self-assesses, then you give the revised grade"
              : "Reviewer only — editors don't self-assess; you fill the rubric"}
          </div>
        </div>
        <GfSwitch on={editorReviewer}
                  onToggle={() => setGamifyGradingMode(editorReviewer ? "reviewer_only" : "editor+reviewer")}
                  label={editorReviewer ? "Editor + Reviewer" : "Reviewer only"}
                  disabled={!gamifyEnabled} />
      </div>

      {/* Toggle 3 — rubric grade-description visibility (cycles off → active → all) */}
      <div className="mon-killrow">
        <div className="mon-killrow-text">
          <div className="mon-killrow-title">Grade descriptions</div>
          <div className="mon-killrow-sub">{DESC_MODE_SUB[rubricDescMode] || DESC_MODE_SUB.all}</div>
        </div>
        <GfSwitch on={rubricDescMode !== "off"}
                  onToggle={() => setRubricDescMode(DESC_MODE_NEXT[rubricDescMode] || "off")}
                  label={DESC_MODE_LABEL[rubricDescMode] || "All"}
                  disabled={!gamifyEnabled} />
      </div>

      {/* Team overlay chart */}
      <div style={{ marginTop: 16 }}>
        <div className="gf-sidebar-title" style={{ marginBottom: 8 }}>Team skill overlay</div>
        {series.length ? (
          <>
            <SpiderChart series={series} size={260} labelMode="short" />
            <div className="gf-legend">
              {rows.filter(r => Object.keys(r.scores).length).map(r => (
                <span key={r.id} className="gf-legend-item">
                  <span className="gf-legend-dot" style={{ background: r.color }} />
                  {r.name}
                </span>
              ))}
            </div>
          </>
        ) : (
          <div className="mon-hint">No skill data yet — grade a reel's rubric to populate the chart.</div>
        )}
      </div>

      {/* Leaderboard */}
      <div style={{ marginTop: 18 }}>
        <div className="gf-sidebar-title" style={{ marginBottom: 8 }}>XP leaderboard</div>
        <div className="gf-leaderboard">
          {rows.map(r => {
            const tier = MEDAL_TIERS.find(t => t.id === r.medal);
            return (
              <div key={r.id} className="gf-lb-row">
                <span>{r.name}</span>
                <span className="gf-lb-xp">{r.totalXp.toLocaleString()} XP</span>
                <span className="gf-lb-medal" style={{ color: tier?.color || "var(--fg-mute)" }}>
                  {tier ? tier.id : "—"}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AiCreditsSection() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

      // Count bot conversations this month (each = 1 Cohere embed call for the question)
      const { count: botCount } = await supabase
        .from("bot_conversations")
        .select("*", { count: "exact", head: true })
        .gte("created_at", monthStart);

      // Count approved faq_pairs (each approval = 1 Cohere embed call)
      const { count: faqCount } = await supabase
        .from("faq_pairs")
        .select("*", { count: "exact", head: true })
        .eq("approved", true)
        .gte("approved_at", monthStart);

      // Total bot conversations all time
      const { count: totalConvos } = await supabase
        .from("bot_conversations")
        .select("*", { count: "exact", head: true });

      // Most used FAQ this month
      const { data: topFaq } = await supabase
        .from("faq_pairs")
        .select("question, use_count")
        .gt("use_count", 0)
        .order("use_count", { ascending: false })
        .limit(1)
        .single();

      const embedsThisMonth = (botCount || 0) + (faqCount || 0);
      const cohereLimit = 1000;
      const coherePct = Math.round((embedsThisMonth / cohereLimit) * 100);

      setStats({
        embedsThisMonth,
        faqApprovals: faqCount || 0,
        botQueries: botCount || 0,
        cohereLimit,
        coherePct,
        totalConvos: totalConvos || 0,
        topFaq,
      });
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <div className="mon-loading">Loading…</div>;
  if (!stats) return null;

  const monthName = new Date().toLocaleString("en-US", { month: "long" });

  return (
    <div className="mon-section-body">
      <UsageBar
        label={`Cohere API calls — ${stats.embedsThisMonth} / ${stats.cohereLimit} this month (free tier)`}
        pct={stats.coherePct}
        detail={`${stats.faqApprovals} FAQ embeddings + ${stats.botQueries} bot questions`}
      />
      <div className="mon-stats-grid" style={{ marginTop: 8 }}>
        <StatRow label={`Bot questions (${monthName})`} value={fmt(stats.botQueries)} tone="ok" />
        <StatRow label={`FAQ approvals (${monthName})`} value={fmt(stats.faqApprovals)} tone="ok" />
        <StatRow label="Total bot conversations" value={fmt(stats.totalConvos)} tone="ok" />
        {stats.topFaq && (
          <StatRow
            label="Most asked FAQ"
            value={`"${stats.topFaq.question.slice(0, 40)}…" (${stats.topFaq.use_count}×)`}
          />
        )}
      </div>
      <div className="mon-hint">
        Cohere free tier: 1,000 API calls/month. Each FAQ approval + each bot question = 1 call.
        Resets on the 1st of each month.{" "}
        <a href="https://dashboard.cohere.com" target="_blank" rel="noreferrer"
           style={{ color: "var(--c-cyan)" }}>Cohere dashboard ↗</a>
      </div>
    </div>
  );
}

/* ── Scout — MicroSaaS radar: free-pull limits + live usage ──
   The binding free-tier constraint is the AI dossier step: each newly-found
   product triggers ONE OpenRouter free-model call. The scrape sources (PH/HN/
   GitHub) sit far below their own caps at one daily pull, so OpenRouter's
   per-day cap is what actually limits "free pulls". Live counts read from the
   Scout Supabase (a separate project); degrades to limits-only if unreachable. */
const SCOUT_LLM_DAILY_FREE = 50;     // OpenRouter :free models, <$10 credits ever (fallback)

function ScoutSection() {
  const [s, setS] = useState(null);      // usage counts from the Scout Supabase
  const [q, setQ] = useState(null);      // live OpenRouter quota via fb-scout proxy
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      // 1) Live OpenRouter quota (owner-gated proxy → fb-scout → OpenRouter).
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          const r = await fetch("/api/ai/suggest?action=scout-quota", {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          if (r.ok && alive) setQ(await r.json());
        }
      } catch (_) { /* card still renders with documented defaults */ }

      // 2) Usage counts from the Scout Supabase (a separate project).
      try {
        const now = new Date();
        // OpenRouter's daily quota resets at 00:00 UTC — count "today" in UTC to match.
        const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
        const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
        const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
        const [pRes, dDay, dMonth, newWk, lastRun] = await Promise.all([
          scoutSupabase.from("products").select("*", { count: "exact", head: true }),
          scoutSupabase.from("dossiers").select("*", { count: "exact", head: true }).gte("generated_at", dayStart),
          scoutSupabase.from("dossiers").select("*", { count: "exact", head: true }).gte("generated_at", monthStart),
          scoutSupabase.from("products").select("*", { count: "exact", head: true }).gte("first_seen", weekAgo),
          scoutSupabase.from("scrape_runs").select("finished_at,new").order("finished_at", { ascending: false }).limit(1),
        ]);
        if (!alive) return;
        setS({
          products: pRes.count || 0,
          dossiersToday: dDay.count || 0,
          dossiersMonth: dMonth.count || 0,
          newThisWeek: newWk.count || 0,
          lastRun: (lastRun.data && lastRun.data[0]) || null,
        });
      } catch (_) {
        if (alive) setFailed(true);
      }
    })();
    return () => { alive = false; };
  }, []);

  const today = s?.dossiersToday ?? 0;
  const live = !!(q && q.ok);
  const dailyCap = (live && q.daily_free_limit) || SCOUT_LLM_DAILY_FREE;
  const pct = Math.round((today / dailyCap) * 100);
  const tierLabel = !live ? "—" : q.is_free_tier ? "Free · 50/day" : "Credited · 1,000/day";
  // OpenRouter's rate_limit field is deprecated (returns requests:-1) — ignore it
  // and show the documented free-model policy (20 req/min).
  const rl = live && q.rate_limit;
  const rlLabel = rl && rl.requests > 0 ? `${rl.requests} / ${rl.interval || "min"}` : "20 / min";
  const money = (n) => (n == null ? "—" : "$" + Number(n).toFixed(2));

  return (
    <div className="mon-section-body">
      <UsageBar
        label={`AI dossiers today — ${s ? today : "—"} / ${dailyCap} ${live ? "(live cap)" : "(free tier)"}`}
        pct={s ? pct : null}
        detail="1 dossier per newly-found product = 1 OpenRouter free-model call"
      />

      <div className="mon-stats-grid" style={{ marginTop: 8 }}>
        <StatRow label="OpenRouter tier"        value={tierLabel} tone={live ? "ok" : undefined} />
        <StatRow label="Credits used / balance" value={live ? `${money(q.total_usage)} / ${money(q.total_credits)}` : "—"} />
        <StatRow label="Free pulls / day"        value={`${dailyCap}${live ? "" : "  (50 free · 1,000 w/ $10 credit)"}`} tone="ok" />
        <StatRow label="Free pulls / month"      value={`~${fmt(dailyCap * 30)}`} tone="ok" />
        <StatRow label="Dossiers this month"     value={s ? fmt(s.dossiersMonth) : "—"} />
        <StatRow label="Products tracked"        value={s ? fmt(s.products) : "—"} />
        <StatRow label="New this week"           value={s ? fmt(s.newThisWeek) : "—"} />
        <StatRow label="Last scrape"             value={s?.lastRun?.finished_at ? `${fmtAgo(s.lastRun.finished_at)} · +${fmt(s.lastRun.new || 0)}` : "—"} />
      </div>

      <div className="mon-hint" style={{ margin: "10px 0 4px", opacity: 0.7 }}>
        Source caps (free tier) — none come close at one scrape/day
      </div>
      <div className="mon-stats-grid">
        <StatRow label="OpenRouter models" value={`${rlLabel} · failed calls count`} />
        <StatRow label="Hacker News"       value="~unlimited" />
        <StatRow label="GitHub Search"     value="30 req/min" />
        <StatRow label="Product Hunt"      value="6,250 pts / 15 min" />
      </div>

      <div className="mon-hint">
        The AI dossier step is the binding limit: each newly-found product = 1 OpenRouter free-model
        call. Free tier = 50 requests/day (auto-jumps to 1,000/day after a one-time $10 credit that
        never expires); 20/min; failed calls still count. Auto-scrape runs daily at 06:00 UTC; manual
        ↻ Refresh anytime.{!live ? "  (live quota unavailable — showing documented limits.)" : ""}{failed ? "  (Scout DB counts unavailable.)" : ""}{" "}
        <a href="https://openrouter.ai/settings/credits" target="_blank" rel="noreferrer"
           style={{ color: "var(--c-cyan)" }}>OpenRouter credits ↗</a>
      </div>
    </div>
  );
}

/* ── Main Monitor component ──────────────────────────────── */
export function Monitor() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [lastFetch, setLastFetch] = useState(null);
  const [fromCache, setFromCache] = useState(false);
  const [toast, setToast]     = useState(null);

  // Mirror the latest merged data into a ref so load() can read it as the
  // "previous" payload without re-creating the callback on every change.
  const dataRef = React.useRef(null);
  useEffect(() => { dataRef.current = data; }, [data]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/monitor/status");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      const now = Date.now();
      // Merge per-section so a transient failure in ONE provider (e.g. the
      // Hetzner OS metrics tick timing out) doesn't blank that card — we keep
      // its last-good value and flag it stale instead of wiping it.
      const merged = mergeStatus(dataRef.current, d);
      setData(merged);
      setLastFetch(new Date(now));
      setFromCache(false);
      setError(null);
      // Cache the MERGED (last-good) payload so the next visit renders fully
      // populated without burning another round of provider-API calls.
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: now, payload: stripStale(merged) })); } catch (_) {}
      checkThresholds(merged);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  function checkThresholds(d) {
    const alerts = [];
    const sb = d.supabase;
    if (sb?.configured) {
      if (sb.rowPct >= WARN_PCT) alerts.push(`Supabase rows at ${sb.rowPct}%`);
      if (sb.storage?.dbPct >= WARN_PCT)        alerts.push(`Supabase DB at ${sb.storage.dbPct}%`);
      if (sb.storage?.filePct >= WARN_PCT)      alerts.push(`Supabase storage at ${sb.storage.filePct}%`);
      if (sb.storage?.bandwidthPct >= WARN_PCT) alerts.push(`Supabase bandwidth at ${sb.storage.bandwidthPct}%`);
    }
    const hz = d.hetzner;
    if (hz?.configured && hz.bwPct >= WARN_PCT) alerts.push(`Hetzner bandwidth at ${hz.bwPct}%`);
    const os = d.os;
    if (os?.configured) {
      if (os.memPct  >= WARN_PCT) alerts.push(`Server memory at ${os.memPct}%`);
      if (os.diskPct >= WARN_PCT) alerts.push(`Server disk at ${os.diskPct}%`);
      if (os.swapPct >= WARN_PCT) alerts.push(`Server swap at ${os.swapPct}%`);
    }
    const gcp = d.gcp;
    if (gcp?.configured && gcp.youtube?.quotaPct >= WARN_PCT)
      alerts.push(`YouTube quota at ${gcp.youtube.quotaPct}%`);

    const wm = d.worldMonitor;
    if (wm?.configured) {
      if (wm.firmsDailyPct >= WARN_PCT) alerts.push(`FIRMS daily quota at ${wm.firmsDailyPct}%`);
      if (wm.acledPct >= WARN_PCT)      alerts.push(`ACLED quota at ${wm.acledPct}%`);
      if (wm.embedEnabled && wm.embedOk === false) alerts.push("World embed unreachable");
    }

    if (alerts.length) {
      setToast(alerts.join("  ·  "));
    }
  }

  // On mount: render the cached payload immediately, then only hit the
  // API if the cache is older than POLL_MS (or absent). This keeps the
  // page useful offline and avoids a provider-API call on every visit.
  useEffect(() => {
    let stale = true;
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const { ts, payload } = JSON.parse(raw);
        if (payload) {
          setData(payload);
          setLastFetch(new Date(ts));
          setFromCache(true);
          setLoading(false);
          stale = Date.now() - ts > POLL_MS;
        }
      }
    } catch (_) {}
    if (stale) load();
  // run once on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div className="monitor">
      <Toast msg={toast} onDismiss={() => setToast(null)} />

      <div className="page-head">
        <div className="titles">
          <h1>Infrastructure monitor</h1>
          <div className="sub">
            Supabase, Hetzner server, and Google Cloud quota usage.
            Alerts when any metric crosses 80% of its limit.
          </div>
        </div>
        <div className="actions" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {loading && <span className="mono muted" style={{ fontSize: 11 }}>refreshing…</span>}
          {lastFetch && !loading && (
            <span className="mono muted" style={{ fontSize: 11 }}>
              updated {relTime(lastFetch.toISOString())}{fromCache ? " (cached)" : ""}
            </span>
          )}
          <DPill onClick={load}>Refresh</DPill>
        </div>
      </div>

      {error && (
        <div className="mon-error" style={{ margin: "0 22px 16px" }}>
          Failed to load: {error}
        </div>
      )}

      <div className="mon-grid">
        <Card title="Supabase" footLeft="Database · Storage · Bandwidth">
          {data?.supabase?._stale && <StaleTag />}
          <SupabaseSection data={data?.supabase} />
        </Card>

        <Card title="Hetzner server" footLeft="api.footagebrain.com · Docker host">
          {data?.hetzner?._stale && <StaleTag />}
          <HetznerSection data={data?.hetzner} />
        </Card>

        <Card title="Server OS" footLeft="Memory · Swap · Disk · Load">
          {data?.os?._stale && <StaleTag />}
          <OsSection data={data?.os} />
        </Card>

        <Card title="Google Cloud" footLeft="YouTube · Maps · Cloud Billing">
          {data?.gcp?._stale && <StaleTag />}
          <GcpSection data={data?.gcp} />
        </Card>

        <Card title="AI Credits" footLeft="Cohere free tier · FAQ bot usage">
          <AiCreditsSection />
        </Card>

        <Card title="News Monitor" footLeft="Pulse feeds · auto-ingest health">
          <NewsMonitorSection />
        </Card>

        <Card title="World Monitor" footLeft="Free APIs · Limits · Usage">
          {data?.worldMonitor?._stale && <StaleTag />}
          <WorldMonitorSection data={data?.worldMonitor} />
        </Card>

        <Card title="Scout" footLeft="MicroSaaS radar · free pull limits">
          <ScoutSection />
        </Card>

        <Card title="Vercel" footLeft="Hosting · Functions · Bandwidth">
          <div className="mon-section-body">
            <div className="mon-hint" style={{ marginBottom: 10 }}>
              Vercel does not expose usage metrics via API — function invocations,
              bandwidth, and build minutes are only visible in their dashboard.
            </div>
            <a
              href="https://vercel.com/dashboard/usage"
              target="_blank"
              rel="noreferrer"
              className="mon-vercel-link"
            >
              Open Vercel usage dashboard ↗
            </a>
            <div className="mon-stats-grid" style={{ marginTop: 14 }}>
              <StatRow label="Project" value="ziflow-project-final" />
              <StatRow label="Domain" value="footagebrain.com" />
              <StatRow label="Runtime" value="Vercel Serverless (Node 18)" />
            </div>
          </div>
        </Card>

        <Card title="Anthropic (Claude)" footLeft="Generate · AI Brain · FAQ bot">
          <AnthropicSection />
        </Card>

        <Card title="🎮 Gamify" footLeft="Skill XP · Spider charts · Rubrics">
          <GamifySection />
        </Card>
      </div>

      <div style={{ padding: "0 22px 40px" }}>
        <Card title="Social accounts — token health" footLeft="OAuth expiry · Last health check">
          <SocialTokenSection />
        </Card>
      </div>
    </div>
  );
}
