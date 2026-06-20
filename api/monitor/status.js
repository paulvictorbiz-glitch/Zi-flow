// Monitor status endpoint — aggregates usage metrics from Supabase, Hetzner,
// and Google Cloud and returns them as a single JSON response.
// All secrets (API tokens, service account JSON) stay server-side via env vars.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const config = { maxDuration: 45 };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  // Lightweight sub-action: compare codebase migrations vs the DB.
  // Folded in here (not a new api/* route) to stay under the Vercel
  // Hobby 12-function cap.
  if (req.query?.action === "migrations") {
    res.status(200).json(await checkMigrations());
    return;
  }

  const [sbResult, hzResult, gcpResult, osResult, wmResult] = await Promise.allSettled([
    fetchSupabaseStats(),
    fetchHetznerStats(),
    fetchGcpStats(),
    fetchHetznerOsMetrics(),
    fetchWorldMonitorStats(),
  ]);

  res.status(200).json({
    ts: new Date().toISOString(),
    supabase: sbResult.status === "fulfilled" ? sbResult.value : { error: sbResult.reason?.message },
    hetzner:  hzResult.status  === "fulfilled" ? hzResult.value  : { error: hzResult.reason?.message  },
    gcp:      gcpResult.status === "fulfilled" ? gcpResult.value : { error: gcpResult.reason?.message },
    os:       osResult.status  === "fulfilled" ? osResult.value  : { configured: false },
    worldMonitor: wmResult.status === "fulfilled" ? wmResult.value : { configured: true, error: wmResult.reason?.message },
  });
}

// ── Migration health check ─────────────────────────────────────────────────────
// Compares the committed migration manifest (filenames + checksums) against the
// schema_migrations tracking table in the live DB. Returns a structured report
// the Monitor card renders as a log.

async function checkMigrations() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return { ok: false, configured: false, error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set." };
  }

  // Load the manifest bundled alongside this function.
  let manifest;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    manifest = JSON.parse(readFileSync(join(here, "migrations.manifest.json"), "utf8"));
  } catch (e) {
    return { ok: false, manifestMissing: true,
      error: "Could not read migrations.manifest.json: " + e.message +
      " — run `npm run migrate:manifest` and redeploy." };
  }

  const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: rows, error } = await sb
    .from("schema_migrations")
    .select("version, checksum");

  if (error) {
    if (/does not exist|Could not find the table|PGRST205/i.test(error.message)) {
      return { ok: false, error:
        "schema_migrations table not found. Run supabase/_migration_bootstrap.sql once in the Supabase SQL editor." };
    }
    return { ok: false, error: "DB query failed: " + error.message };
  }

  const applied = new Map(rows.map((r) => [r.version, r.checksum]));
  const expected = manifest.migrations || [];

  const missing = [];   // in codebase, not in DB → never applied
  const changed = [];   // applied but file edited since (checksum mismatch)
  for (const m of expected) {
    if (!applied.has(m.version)) { missing.push(m.version); continue; }
    const dbSum = applied.get(m.version);
    if (dbSum && m.checksum && dbSum !== m.checksum) changed.push(m.version);
  }
  // In DB but not in the codebase → applied something we don't have a file for.
  const expectedVersions = new Set(expected.map((m) => m.version));
  const orphaned = [...applied.keys()].filter((v) => !expectedVersions.has(v));

  const issues = missing.length + changed.length + orphaned.length;
  return {
    ok: issues === 0,
    counts: { expected: expected.length, applied: applied.size, missing: missing.length,
              changed: changed.length, orphaned: orphaned.length },
    missing, changed, orphaned,
    manifestGenerated: manifest.generated || null,
  };
}

// ── Supabase ──────────────────────────────────────────────────────────────────

async function fetchSupabaseStats() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { configured: false };

  const sb = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const tables = [
    "reels", "people", "tasks", "attached_footage_items",
    "review_lane_cards", "daily_tasks", "app_settings",
    "resource_columns", "resource_rows", "resource_cells",
  ];

  const counts = await Promise.all(
    tables.map(t => sb.from(t).select("*", { count: "exact", head: true }))
  );
  const rows = Object.fromEntries(tables.map((t, i) => [t, counts[i].count ?? 0]));
  const totalRows = Object.values(rows).reduce((a, b) => a + b, 0);

  // Supabase free tier: 500 MB DB, 1 GB file storage, 5 GB bandwidth.
  // Row count limit is effectively the DB size limit (soft ~50k rows on free).
  const result = {
    configured: true,
    rows,
    totalRows,
    rowLimit: 50000,   // free tier soft limit
    rowPct: Math.round((totalRows / 50000) * 100),
  };

  // Exact database + storage size and MAU via the Management API's SQL
  // query endpoint. The old /v1/projects/{ref}/usage endpoint was removed
  // (404), and the /platform billing counters that hold egress + realtime
  // message totals require a dashboard session cookie — a personal access
  // token gets 401 — so those two aren't reachable here. We surface what a
  // PAT *can* read (run as postgres): db size, storage object bytes, and
  // 30-day active auth users.
  const mgmtToken = process.env.SUPABASE_MANAGEMENT_TOKEN;
  const projectRef = process.env.SUPABASE_PROJECT_REF;
  if (mgmtToken && projectRef) {
    try {
      const sql =
        "select pg_database_size(current_database()) as db_size, " +
        "(select coalesce(sum((metadata->>'size')::bigint),0) from storage.objects) as storage_size, " +
        "(select count(*) from auth.users where last_sign_in_at > now() - interval '30 days') as mau";
      const r = await fetch(
        `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${mgmtToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ query: sql }),
        }
      );
      if (r.ok) {
        const rows = await r.json();
        const row = Array.isArray(rows) ? rows[0] : null;
        if (row) {
          const dbBytes   = Number(row.db_size) || 0;
          const fileBytes = Number(row.storage_size) || 0;
          result.storage = {
            dbBytes,
            dbBytesLimit:   500 * 1024 * 1024,       // 500 MB free tier
            fileBytes,
            fileBytesLimit: 1 * 1024 * 1024 * 1024,  // 1 GB
          };
          result.storage.dbPct   = pct(dbBytes,   result.storage.dbBytesLimit);
          result.storage.filePct = pct(fileBytes, result.storage.fileBytesLimit);
          result.mau = Number(row.mau) || 0;
        }
      }
    } catch { /* optional — skip if unavailable */ }
  }

  return result;
}

// ── World Monitor ───────────────────────────────────────────────────────────
// Reads the hybrid World Monitor config (`world_monitor` flags) and usage
// counters (`world_monitor_usage`) from app_settings. NO live HEAD/fetch here
// (would risk the function timeout) — embed health rides the stored
// `embed_ok` flag, which the ingest writer (api/ai/_world-feeds.js) maintains.
// Team D is the SOLE reader of both keys and the SOLE writer of `world_monitor`
// (the Monitor card's owner-write toggle); Team B is the sole writer of
// `world_monitor_usage`.

async function fetchWorldMonitorStats() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { configured: false };

  const sb = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: rows, error } = await sb
    .from("app_settings")
    .select("key, value")
    .in("key", ["world_monitor", "world_monitor_usage"]);

  if (error) return { configured: true, error: error.message };

  const byKey = Object.fromEntries((rows || []).map((r) => [r.key, r.value || {}]));
  const cfg   = byKey.world_monitor || {};
  const usage = byKey.world_monitor_usage || {};

  const free = {
    usgs:  cfg.free?.usgs  === true,
    firms: cfg.free?.firms === true,
    acled: cfg.free?.acled === true,
  };
  const paid = {
    finnhub: cfg.paid?.finnhub === true,
    fred:    cfg.paid?.fred    === true,
    imf:     cfg.paid?.imf     === true,
    nasdaq:  cfg.paid?.nasdaq  === true,
    flights: cfg.paid?.flights === true,
  };

  const firmsDailyUsed  = Number(usage.firms_daily_used)  || 0;
  const firmsDailyLimit = Number(usage.firms_daily_limit) || 0;
  const acledUsed       = Number(usage.acled_used)        || 0;
  const acledLimit      = Number(usage.acled_limit)       || 0;

  return {
    configured: true,
    embedEnabled: cfg.embed_enabled === true,
    embedOk: usage.embed_ok !== false,   // default healthy unless explicitly false
    free,
    paid,
    firmsDailyUsed,
    firmsDailyLimit,
    firmsDailyPct: pct(firmsDailyUsed, firmsDailyLimit),
    acledUsed,
    acledLimit,
    acledPct: pct(acledUsed, acledLimit),
    usgsCount: Number(usage.usgs_count) || 0,
    lastIngestAt: usage.last_ingest_at ?? null,
  };
}

// ── Hetzner ───────────────────────────────────────────────────────────────────

async function fetchHetznerStats() {
  const token    = process.env.HETZNER_API_TOKEN;
  const serverId = process.env.HETZNER_SERVER_ID;
  if (!token || !serverId) return { configured: false };

  const BASE = "https://api.hetzner.cloud/v1";
  const headers = { Authorization: `Bearer ${token}` };

  const now   = new Date();
  const start = new Date(now.getTime() - 7 * 86400 * 1000).toISOString();
  const end   = now.toISOString();

  const [serverRes, metricsRes] = await Promise.all([
    fetch(`${BASE}/servers/${serverId}`, { headers }),
    fetch(
      `${BASE}/servers/${serverId}/metrics?type=cpu,disk,network` +
      `&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&step=3600`,
      { headers }
    ),
  ]);

  if (!serverRes.ok) throw new Error(`Hetzner server API ${serverRes.status}`);
  const { server } = await serverRes.json();

  let timeseries = {};
  if (metricsRes.ok) {
    const md = await metricsRes.json();
    timeseries = md.metrics?.time_series || {};
  }

  const outgoing = server.outgoing_traffic || 0;
  const incoming = server.incoming_traffic || 0;
  const bwLimit  = server.server_type?.included_traffic || 0; // bytes/month

  return {
    configured: true,
    name:      server.name,
    status:    server.status,
    location:  server.datacenter?.location?.name,
    type:      server.server_type?.name,
    cores:     server.server_type?.cores,
    ramGb:     server.server_type?.memory,
    diskGb:    server.server_type?.disk,
    outgoing,
    incoming,
    bwLimit,
    bwPct: bwLimit > 0 ? pct(outgoing, bwLimit) : null,
    timeseries,
  };
}

// ── Hetzner OS metrics ────────────────────────────────────────────────────────

async function fetchHetznerOsMetrics() {
  const base = process.env.FB_PROXY_TARGET || "https://api.footagebrain.com";
  // /api/metrics runs `docker stats` (~3s) on the box; allow generous headroom for
  // TLS + Vercel→Hetzner latency so a slow tick doesn't drop the OS donuts. The
  // parent handler caps at maxDuration: 45, so two 12s attempts stay well within
  // budget. A single slow tick or transient 5xx is the usual cause of the OS
  // donuts intermittently going blank, so retry once before giving up — the
  // client also keeps last-good, but reducing the blip at the source means the
  // card stays live more often.
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 12000);
    try {
      const r = await fetch(`${base}/api/metrics`, { signal: controller.signal });
      if (r.ok) {
        const d = await r.json();
        if (d.ok) return { configured: true, ...d };
      }
    } catch {
      /* fall through to retry / give up */
    } finally {
      clearTimeout(t);
    }
  }
  return { configured: false };
}

// ── Google Cloud ──────────────────────────────────────────────────────────────

async function fetchGcpStats() {
  const saJson    = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
  if (!saJson || !projectId) return { configured: false };

  let sa;
  try { sa = JSON.parse(saJson); } catch {
    return { configured: false, error: "Invalid GOOGLE_SERVICE_ACCOUNT_JSON" };
  }

  let token;
  try {
    token = await mintServiceAccountToken(sa, [
      "https://www.googleapis.com/auth/monitoring.read",
      "https://www.googleapis.com/auth/cloud-platform.read-only",
    ]);
  } catch (e) {
    return { configured: true, error: "Failed to mint GCP token: " + e.message };
  }

  const headers = { Authorization: `Bearer ${token}` };
  const now   = new Date();
  const start24h = new Date(now.getTime() - 86400 * 1000).toISOString();
  const start7d  = new Date(now.getTime() - 7 * 86400 * 1000).toISOString();
  const nowIso   = now.toISOString();
  const monBase  = `https://monitoring.googleapis.com/v3/projects/${projectId}/timeSeries`;

  const abortFetch = (url, opts, ms) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(t));
  };

  // Helper: fetch a quota metric and sum all points
  const fetchQuota = async (service) => {
    const filter = [
      `metric.type="serviceruntime.googleapis.com/quota/rate/net_usage"`,
      `resource.labels.service="${service}"`,
    ].join(" AND ");
    try {
      const r = await abortFetch(
        `${monBase}?filter=${encodeURIComponent(filter)}&interval.startTime=${encodeURIComponent(start24h)}&interval.endTime=${encodeURIComponent(nowIso)}`,
        { headers }, 8000
      );
      if (!r.ok) return 0;
      const d = await r.json();
      return (d.timeSeries || [])
        .flatMap(ts => ts.points || [])
        .reduce((sum, pt) => sum + Number(pt.value?.int64Value || pt.value?.doubleValue || 0), 0);
    } catch { return 0; }
  };

  // Helper: fetch a request count metric and sum 7-day points
  const fetchRequestCount = async (service) => {
    const filter = [
      `metric.type="serviceruntime.googleapis.com/api/request_count"`,
      `resource.labels.service="${service}"`,
    ].join(" AND ");
    try {
      const r = await abortFetch(
        `${monBase}?filter=${encodeURIComponent(filter)}&interval.startTime=${encodeURIComponent(start7d)}&interval.endTime=${encodeURIComponent(nowIso)}`,
        { headers }, 8000
      );
      if (!r.ok) return 0;
      const d = await r.json();
      return (d.timeSeries || [])
        .flatMap(ts => ts.points || [])
        .reduce((sum, pt) => sum + Number(pt.value?.int64Value || pt.value?.doubleValue || 0), 0);
    } catch { return 0; }
  };

  // Helper: peak requests-in-any-single-minute over the last 24h. Aligning the
  // series to 60s buckets and taking the MAX point tells us how close we got to
  // the per-minute quota ceiling (the "Requests per minute" limit GCP shows but
  // won't let us edit — it's fixed and non-adjustable on these APIs).
  const fetchPeakRate = async (service) => {
    const filter = [
      `metric.type="serviceruntime.googleapis.com/api/request_count"`,
      `resource.labels.service="${service}"`,
    ].join(" AND ");
    try {
      const r = await abortFetch(
        `${monBase}?filter=${encodeURIComponent(filter)}` +
        `&interval.startTime=${encodeURIComponent(start24h)}&interval.endTime=${encodeURIComponent(nowIso)}` +
        `&aggregation.alignmentPeriod=60s&aggregation.perSeriesAligner=ALIGN_RATE`,
        { headers }, 8000
      );
      if (!r.ok) return 0;
      const d = await r.json();
      // ALIGN_RATE gives per-second rate; ×60 ≈ requests/minute. Take the peak.
      const peakPerSec = (d.timeSeries || [])
        .flatMap(ts => ts.points || [])
        .reduce((mx, pt) => Math.max(mx, Number(pt.value?.doubleValue || pt.value?.int64Value || 0)), 0);
      return Math.round(peakPerSec * 60);
    } catch { return 0; }
  };

  // Per-minute quota ceilings GCP enforces on these APIs (the "Requests per
  // minute" rows in the console, marked Adjustable=No). Used to draw % bars.
  const RPM_LIMITS = {
    maps:      30000, // Maps JS API (maps-backend) default
    places:    6000,  // Places API — matches console screenshot
    geocoding: 3000,  // Geocoding API default
  };

  // Maps backend = JS API map loads. The Locations page also uses Places
  // (autocomplete) and Geocoding (address → lat/lng), each its own service,
  // so pull their 7-day request counts AND peak per-minute usage too.
  const [
    ytQuota, mapsQuota, ytRequests, mapsRequests, placesRequests, geocodeRequests,
    mapsPeak, placesPeak, geocodePeak,
  ] = await Promise.all([
      fetchQuota("youtube.googleapis.com"),
      fetchQuota("maps-backend.googleapis.com"),
      fetchRequestCount("youtube.googleapis.com"),
      fetchRequestCount("maps-backend.googleapis.com"),
      fetchRequestCount("places-backend.googleapis.com"),
      fetchRequestCount("geocoding-backend.googleapis.com"),
      fetchPeakRate("maps-backend.googleapis.com"),
      fetchPeakRate("places-backend.googleapis.com"),
      fetchPeakRate("geocoding-backend.googleapis.com"),
    ]);

  // Current-month spend via the Cloud Billing cost metric. Optional — only runs
  // if GCP_BILLING_ACCOUNT_ID is set AND the service account has roles/billing.viewer.
  // Returns null (not 0) when unavailable so the UI shows a config hint.
  let billingCost = null;
  const billingAccountId = process.env.GCP_BILLING_ACCOUNT_ID;
  if (billingAccountId) {
    try {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const billingFilter = [
        `metric.type="billing.googleapis.com/billing/cost"`,
        `resource.labels.project_id="${projectId}"`,
      ].join(" AND ");
      const br = await abortFetch(
        `${monBase}?filter=${encodeURIComponent(billingFilter)}` +
        `&interval.startTime=${encodeURIComponent(startOfMonth)}` +
        `&interval.endTime=${encodeURIComponent(nowIso)}`,
        { headers }, 8000
      );
      if (br.ok) {
        const bd = await br.json();
        billingCost = (bd.timeSeries || [])
          .flatMap(ts => ts.points || [])
          .reduce((sum, pt) => sum + Number(pt.value?.doubleValue || 0), 0);
        billingCost = Math.round(billingCost * 100) / 100;
      }
    } catch { /* billing optional */ }
  }

  return {
    configured: true,
    projectId,
    billingCost,
    billingConfigured: !!billingAccountId,  // var set? lets the UI distinguish "add var" from "no cost data yet"
    youtube: {
      quotaUsed:  ytQuota,
      quotaLimit: 10000,
      quotaPct:   pct(ytQuota, 10000),
      requests7d: ytRequests,
    },
    maps: {
      quotaUsed:  mapsQuota,
      quotaLimit: 28000,  // Maps JS API free tier: ~$200/mo credit ≈ 28k loads/mo at $7/1000
      quotaPct:   pct(mapsQuota, 28000),
      requests7d: mapsRequests,
      places7d:   placesRequests,
      geocoding7d: geocodeRequests,
      // Per-minute rate bars (peak req/min in last 24h vs the fixed RPM ceiling).
      rpm: {
        maps:      { peak: mapsPeak,    limit: RPM_LIMITS.maps,      pct: pct(mapsPeak,    RPM_LIMITS.maps) },
        places:    { peak: placesPeak,  limit: RPM_LIMITS.places,    pct: pct(placesPeak,  RPM_LIMITS.places) },
        geocoding: { peak: geocodePeak, limit: RPM_LIMITS.geocoding, pct: pct(geocodePeak, RPM_LIMITS.geocoding) },
      },
    },
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(used, limit) {
  if (!limit) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

async function mintServiceAccountToken(sa, scopes) {
  const now = Math.floor(Date.now() / 1000);
  const header  = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: scopes.join(" "),
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  }));

  const key = await importRsaKey(sa.private_key);
  const sigBuf = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    Buffer.from(`${header}.${payload}`)
  );
  const sig = Buffer.from(sigBuf).toString("base64url");
  const jwt = `${header}.${payload}.${sig}`;

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  if (!r.ok) throw new Error(`Token exchange failed: ${r.status}`);
  const d = await r.json();
  if (!d.access_token) throw new Error("No access_token in response");
  return d.access_token;
}

function b64url(str) {
  return Buffer.from(str).toString("base64url");
}

async function importRsaKey(pem) {
  const pemContents = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const der = Buffer.from(pemContents, "base64");
  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}
