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

const POLL_MS   = 15 * 60 * 1000;
const WARN_PCT  = 80;
const CRIT_PCT  = 95;

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
          <UsageBar
            label={`Bandwidth — ${fmtBytes(data.storage.bandwidthBytes)} / ${fmtBytes(data.storage.bandwidthLimit)}`}
            pct={data.storage.bandwidthPct}
          />
        </div>
      )}

      {!data.storage && (
        <div className="mon-hint">
          Add <code>SUPABASE_MANAGEMENT_TOKEN</code> + <code>SUPABASE_PROJECT_REF</code> for storage/bandwidth metrics.
        </div>
      )}

      <div className="mon-table-label">Row counts by table</div>
      {topTables.map(([t, n]) => (
        <StatRow key={t} label={t} value={fmt(n)} />
      ))}
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

  return (
    <div className="mon-section-body">
      {yt && (
        <UsageBar
          label={`YouTube API quota — ${fmt(yt.quotaUsed)} / ${fmt(yt.quotaLimit)} units today`}
          pct={yt.quotaPct}
        />
      )}
      {yt && (
        <div className="mon-hint">
          Default quota: 10,000 units/day. Each video list request costs 1 unit; search costs 100 units.
        </div>
      )}
    </div>
  );
}

/* ── Main Monitor component ──────────────────────────────── */
export function Monitor() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [lastFetch, setLastFetch] = useState(null);
  const [toast, setToast]     = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/monitor/status");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setData(d);
      setLastFetch(new Date());
      checkThresholds(d);
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
    const gcp = d.gcp;
    if (gcp?.configured && gcp.youtube?.quotaPct >= WARN_PCT)
      alerts.push(`YouTube quota at ${gcp.youtube.quotaPct}%`);

    if (alerts.length) {
      setToast(alerts.join("  ·  "));
    }
  }

  useEffect(() => { load(); }, [load]);
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
              updated {relTime(lastFetch.toISOString())}
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
          <SupabaseSection data={data?.supabase} />
        </Card>

        <Card title="Hetzner server" footLeft="api.footagebrain.com · Docker host">
          <HetznerSection data={data?.hetzner} />
        </Card>

        <Card title="Google Cloud" footLeft="YouTube Data API v3 quota">
          <GcpSection data={data?.gcp} />
        </Card>
      </div>
    </div>
  );
}
