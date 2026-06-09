// Monitor status endpoint — aggregates usage metrics from Supabase, Hetzner,
// and Google Cloud and returns them as a single JSON response.
// All secrets (API tokens, service account JSON) stay server-side via env vars.

import { createClient } from "@supabase/supabase-js";

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  const [sbResult, hzResult, gcpResult] = await Promise.allSettled([
    fetchSupabaseStats(),
    fetchHetznerStats(),
    fetchGcpStats(),
  ]);

  res.status(200).json({
    ts: new Date().toISOString(),
    supabase: sbResult.status === "fulfilled" ? sbResult.value : { error: sbResult.reason?.message },
    hetzner:  hzResult.status  === "fulfilled" ? hzResult.value  : { error: hzResult.reason?.message  },
    gcp:      gcpResult.status === "fulfilled" ? gcpResult.value : { error: gcpResult.reason?.message },
  });
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

  // Optional: Supabase Management API for exact storage/bandwidth bytes.
  const mgmtToken = process.env.SUPABASE_MANAGEMENT_TOKEN;
  const projectRef = process.env.SUPABASE_PROJECT_REF;
  if (mgmtToken && projectRef) {
    try {
      const r = await fetch(
        `https://api.supabase.com/v1/projects/${projectRef}/usage`,
        { headers: { Authorization: `Bearer ${mgmtToken}` } }
      );
      if (r.ok) {
        const usage = await r.json();
        result.storage = {
          dbBytes:        usage.db_size_bytes       || 0,
          dbBytesLimit:   500 * 1024 * 1024,         // 500 MB
          fileBytes:      usage.storage_size_bytes  || 0,
          fileBytesLimit: 1 * 1024 * 1024 * 1024,    // 1 GB
          bandwidthBytes: usage.bandwidth_bytes     || 0,
          bandwidthLimit: 5 * 1024 * 1024 * 1024,    // 5 GB
        };
        result.storage.dbPct        = pct(result.storage.dbBytes,        result.storage.dbBytesLimit);
        result.storage.filePct      = pct(result.storage.fileBytes,      result.storage.fileBytesLimit);
        result.storage.bandwidthPct = pct(result.storage.bandwidthBytes, result.storage.bandwidthLimit);
      }
    } catch { /* optional — skip if unavailable */ }
  }

  return result;
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
    ]);
  } catch (e) {
    return { configured: true, error: "Failed to mint GCP token: " + e.message };
  }

  const now   = new Date();
  const start = new Date(now.getTime() - 86400 * 1000).toISOString(); // last 24h

  // Query YouTube Data API v3 quota usage (10,000 units/day default).
  const filter = [
    `metric.type="serviceruntime.googleapis.com/quota/rate/net_usage"`,
    `resource.labels.service="youtube.googleapis.com"`,
  ].join(" AND ");

  const tsUrl =
    `https://monitoring.googleapis.com/v3/projects/${projectId}/timeSeries` +
    `?filter=${encodeURIComponent(filter)}` +
    `&interval.startTime=${encodeURIComponent(start)}` +
    `&interval.endTime=${encodeURIComponent(now.toISOString())}`;

  let usedUnits = 0;
  try {
    const r = await fetch(tsUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) {
      const d = await r.json();
      usedUnits = (d.timeSeries || [])
        .flatMap(ts => ts.points || [])
        .reduce((sum, pt) => sum + Number(pt.value?.int64Value || pt.value?.doubleValue || 0), 0);
    }
  } catch { /* quota API unavailable — leave at 0 */ }

  return {
    configured: true,
    youtube: {
      quotaUsed:  usedUnits,
      quotaLimit: 10000,
      quotaPct:   pct(usedUnits, 10000),
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
