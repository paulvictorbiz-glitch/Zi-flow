/**
 * GET  /api/ai/suggest?secret=<SUGGEST_CRON_SECRET>
 *   Triggered daily by a Hetzner cron job. Reviews the last 7 days of unresolved
 *   ai_notes, identifies recurring patterns, and generates up to 3 improvement
 *   suggestions stored in improvement_suggestions.
 *   Deduplicates against existing suggestions (same title within 14 days → skip).
 *
 * POST /api/ai/suggest?action=ig-sync
 *   Owner-triggered (Reel DNA "Refresh" button, Bearer JWT). Kicks the Hetzner
 *   Instagram-DM poller to run NOW instead of waiting for its 15-min cron, so a
 *   reel just DM'd to the Page shows up in seconds. Fire-and-forget: the poll
 *   runs in the background on Hetzner and the new reel_dna rows arrive via
 *   Supabase realtime. The IG_SYNC_SECRET stays server-side here (never shipped
 *   to the browser). Folded into this route to stay under the 12-function cap.
 *
 * GET/POST /api/ai/suggest?action=insights
 *   Workflow Intelligence Log pass — distills recent Rocket.Chat conversations
 *   into workflow_insights (see _insights-core.js). Triggered by the AI Brain
 *   "Parse now" button (Bearer JWT) or a daily cron (secret). Uses a free
 *   OpenRouter model, so it is NOT gated by the Anthropic kill switch.
 *
 * Both actions share SUGGEST_CRON_SECRET. Folded into one route to stay under the
 * Vercel Hobby 12-function limit.
 *
 * Setup on Hetzner host (crontab -e):
 *   0  8 * * * curl -s "https://footagebrain.com/api/ai/suggest?secret=YOUR_SECRET" > /dev/null
 *   30 8 * * * curl -s "https://footagebrain.com/api/ai/suggest?action=insights&secret=YOUR_SECRET" > /dev/null
 */

import { createHmac } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { adminClient, setCors, isAnthropicEnabled, ANTHROPIC_PAUSED, classifyCaller, verifyOwner } from "../admin/_auth.js";
import { runInsights } from "./_insights-core.js";
import { ingestSources, validateFeedUrl, parseYouTubePlaylistFeed } from "./_rss.js";
import { ingestWorldEvents } from "./_world-feeds.js";

export const config = { maxDuration: 45 };

// undici/fetch (and browsers) reject any HTTP header VALUE containing a code
// point above U+00FF with: "String contains non ISO-8859-1 code point". So any
// secret/env value placed in a header must be made Latin-1-safe first. We
// percent-encode it (pure ASCII on the wire); the Scout backend decodes with
// urllib.parse.unquote (main.py). Pure-ASCII input (e.g. a hex secret) encodes
// to itself, so this is a no-op for clean values and a guard against a dirty one
// (a stray smart-quote / non-breaking-space / BOM pasted into the env var).
function asciiHeader(value) {
  return encodeURIComponent(String(value ?? ""));
}

export default async function handler(req, res) {
  setCors(res, req);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  const url = req.url && new URL(req.url, "https://footagebrain.com");
  const action = req.query?.action || url?.searchParams.get("action");
  const secret = req.query?.secret || url?.searchParams.get("secret");

  // ── Auth: cron secret (query) OR owner Bearer JWT ──────────────────────────
  let authed = !!secret && secret === process.env.SUGGEST_CRON_SECRET;
  if (!authed) {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    if (token) {
      try {
        const { error } = await adminClient().auth.getUser(token);
        if (!error) authed = true;
      } catch { /* fall through */ }
    }
  }
  if (!authed) { res.status(401).json({ error: "Unauthorized" }); return; }

  // ── Dispatch: insights pass lives in the shared core module (free model) ───
  if (action === "insights") {
    return runInsights(req, res);
  }

  // ── Dispatch: force the Hetzner Instagram-DM poller to run now ─────────────
  // Fire-and-forget — we hit /api/ig/sync WITHOUT ?wait so it returns instantly
  // (the poll runs in the background on Hetzner, well under our function
  // timeout); the new reel_dna rows arrive client-side via Supabase realtime.
  if (action === "ig-sync") {
    const igSecret = process.env.IG_SYNC_SECRET;
    if (!igSecret) { res.status(500).json({ error: "IG_SYNC_SECRET not configured" }); return; }
    // Truly fire-and-forget: abort our wait after 8s so a slow Hetzner poll can
    // never push us past the Vercel function timeout (Hobby ~10s). If the poll
    // is still running when we abort, that's fine — it finishes server-side and
    // the new reel_dna rows arrive via Supabase realtime / the 15-min cron.
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetch(
        `https://api.footagebrain.com/api/ig/sync?secret=${encodeURIComponent(igSecret)}`,
        { method: "POST", signal: ctrl.signal });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { res.status(502).json({ error: `Hetzner sync HTTP ${r.status}`, ...body }); return; }
      res.status(200).json({ ok: true, started: true, ...body });
    } catch (e) {
      if (e.name === "AbortError") {
        // Poll is taking >8s but is running — report success, not failure.
        res.status(202).json({ ok: true, started: true, pending: true });
        return;
      }
      console.error("ig-sync error:", e.message);
      res.status(502).json({ error: `Couldn't reach the IG poller: ${e.message}` });
    } finally {
      clearTimeout(t);
    }
    return;
  }

  // ── Dispatch: force the Hetzner reel-deconstruction worker to run now ──────
  // Fire-and-forget — we hit /api/reel/deconstruct WITHOUT waiting so it returns
  // instantly (the deconstruction pipeline runs in the background on Hetzner,
  // well under our function timeout); the narrative/progress writes arrive
  // client-side via Supabase realtime. An optional { id } in the JSON body
  // targets one reel_dna row; omitted, the worker claims the next queued row.
  if (action === "deconstruct") {
    const deconstructSecret = process.env.REEL_DECONSTRUCT_SECRET;
    if (!deconstructSecret) { res.status(500).json({ error: "REEL_DECONSTRUCT_SECRET not configured" }); return; }
    const id = req.body?.id;
    // Truly fire-and-forget: abort our wait after 8s so a slow Hetzner run can
    // never push us past the Vercel function timeout (Hobby ~10s). If the run
    // is still going when we abort, that's fine — it finishes server-side and
    // the narrative/progress writes arrive via Supabase realtime / the drain cron.
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetch(
        `https://api.footagebrain.com/api/reel/deconstruct?secret=${encodeURIComponent(deconstructSecret)}` +
          (id ? `&id=${encodeURIComponent(id)}` : ""),
        { method: "POST", signal: ctrl.signal });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { res.status(502).json({ error: `Hetzner deconstruct HTTP ${r.status}`, ...body }); return; }
      res.status(200).json({ ok: true, started: true, ...body });
    } catch (e) {
      if (e.name === "AbortError") {
        // Run is taking >8s but is going — report success, not failure.
        res.status(202).json({ ok: true, started: true, pending: true });
        return;
      }
      console.error("deconstruct error:", e.message);
      res.status(502).json({ error: `Couldn't reach the reel deconstruction worker: ${e.message}` });
    } finally {
      clearTimeout(t);
    }
    return;
  }

  // ── Dispatch: trigger the MicroSaaS Scout scraper on Hetzner ───────────────
  // POST /api/ai/suggest?action=scout-scrape  (owner Bearer JWT — authed above)
  // Fire-and-forget proxy to the Scout FastAPI at {SCOUT_BACKEND_URL}/scrape-all.
  // The SCOUT_SCRAPE_SECRET is kept server-side and injected as a header here;
  // the browser never sees the Scout URL or the secret. The scrape takes ~2 min;
  // we abort our wait after 8s (Hobby fn timeout ~10s) and the run continues on
  // Hetzner. The owner manually clicks "Reload" in the Scout tab when done.
  if (action === "scout-scrape") {
    // Owner-only gate: even though the UI is already isOwner-gated, enforce at
    // the API layer too so a non-owner with a valid JWT can't hit this directly.
    try {
      await verifyOwner(req);
    } catch {
      res.status(403).json({ error: "Owner only" }); return;
    }
    const scoutUrl = process.env.SCOUT_BACKEND_URL;
    const scoutSecret = process.env.SCOUT_SCRAPE_SECRET;
    if (!scoutUrl || !scoutSecret) {
      res.status(500).json({ error: "Scout not configured (SCOUT_BACKEND_URL / SCOUT_SCRAPE_SECRET)" }); return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetch(`${scoutUrl}/scrape-all`, {
        method: "POST",
        signal: ctrl.signal,
        headers: { "x-scout-secret": asciiHeader(scoutSecret) },
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { res.status(502).json({ error: `Scout HTTP ${r.status}`, ...body }); return; }
      res.status(200).json({ ok: true, started: true, ...body });
    } catch (e) {
      if (e.name === "AbortError") {
        res.status(202).json({ ok: true, started: true, pending: true }); return;
      }
      console.error("scout-scrape error:", e.message);
      res.status(502).json({ error: `Couldn't reach Scout: ${e.message}` });
    } finally {
      clearTimeout(t);
    }
    return;
  }

  // ── Dispatch: live OpenRouter quota for the Scout backend's dossier key ────
  // GET/POST /api/ai/suggest?action=scout-quota  (owner Bearer JWT). Proxies the
  // fb-scout /quota endpoint so the Monitor "Scout" card shows REAL usage + tier
  // (auto-detects the 50-vs-1,000/day free cap) instead of a hardcoded guess.
  if (action === "scout-quota") {
    try {
      await verifyOwner(req);
    } catch {
      res.status(403).json({ error: "Owner only" }); return;
    }
    const scoutUrl = process.env.SCOUT_BACKEND_URL;
    const scoutSecret = process.env.SCOUT_SCRAPE_SECRET;
    if (!scoutUrl || !scoutSecret) {
      res.status(500).json({ error: "Scout not configured (SCOUT_BACKEND_URL / SCOUT_SCRAPE_SECRET)" }); return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    try {
      const r = await fetch(`${scoutUrl}/quota`, {
        method: "GET",
        signal: ctrl.signal,
        headers: { "x-scout-secret": asciiHeader(scoutSecret) },
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { res.status(502).json({ error: `Scout HTTP ${r.status}`, ...body }); return; }
      res.status(200).json(body);
    } catch (e) {
      console.error("scout-quota error:", e.message);
      res.status(502).json({ error: `Couldn't reach Scout: ${e.message}` });
    } finally {
      clearTimeout(t);
    }
    return;
  }

  // ── Dispatch: mint a short-lived signed download URL for a reel asset ──────
  // POST /api/ai/suggest?action=sign-download  (owner Bearer JWT — authed above)
  // Body { id, file } → 200 { url: "/fb/reels/<id>/<file>?t=<hmac>&exp=<exp>" }.
  // The /fb/ rewrite (vercel.json) proxies that to api.footagebrain.com which
  // serves the retained reel asset; the Hetzner worker re-mints the SAME HMAC
  // and constant-time-compares before streaming the file (defense in depth).
  //
  // CANONICAL HMAC MESSAGE (H1 — MUST byte-match the Python validator in
  // backend-handoff/reel_deconstruct.py). NO "/fb/" prefix, NO leading slash,
  // NO query string, file = BARE name, exp = unix SECONDS as a plain decimal int:
  //     message = `reels/${id}/${file}:${exp}`
  //     JS:     createHmac('sha256', SECRET).update(message).digest('hex')
  //     Python: hmac.new(SECRET.encode(), f'reels/{id}/{file}:{exp}'.encode(),
  //                       hashlib.sha256).hexdigest()
  // Parity vector (in DEPLOY-PHASE1.md): secret='test-secret-do-not-use',
  //   id='abc123', file='base.mp4', exp=1750000000
  //   → message='reels/abc123/base.mp4:1750000000' → identical lowercase hex.
  if (action === "sign-download") {
    // Demo callers get NO download access (quota/abuse gate). classifyCaller is
    // non-throwing; the generic Bearer-JWT auth above already rejected anon.
    const { isDemo } = await classifyCaller(req);
    if (isDemo) { res.status(403).json({ error: "Downloads are not available on demo accounts." }); return; }

    const body = typeof req.body === "string"
      ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })()
      : (req.body || {});
    const id = body.id;
    const file = body.file;
    // Reject anything that could escape the reels/<id>/<file> path: no slashes,
    // backslashes, "..", query chars — only bare path-segment characters.
    const SEG = /^[A-Za-z0-9._-]+$/;
    if (typeof id !== "string" || typeof file !== "string" || !SEG.test(id) || !SEG.test(file)) {
      res.status(400).json({ error: "Invalid id or file" }); return;
    }

    const secret = process.env.FB_DOWNLOAD_SIGNING_SECRET;
    if (!secret) { res.status(500).json({ error: "FB_DOWNLOAD_SIGNING_SECRET not configured" }); return; }

    const exp = Math.floor(Date.now() / 1000) + 300; // unix SECONDS, 300s TTL
    const message = `reels/${id}/${file}:${exp}`;     // H1 canonical — no /fb/, no leading slash
    const t = createHmac("sha256", secret).update(message).digest("hex");
    // The /fb/ prefix is added ONLY here in the returned URL, never in the HMAC.
    res.status(200).json({ url: `/fb/reels/${id}/${file}?t=${t}&exp=${exp}` });
    return;
  }

  // ── Dispatch: news-monitor RSS ingest (free model; not Anthropic-gated) ────
  // Triggered by the Pulse "Refresh now" button (Bearer JWT) or a Hetzner cron
  // (secret): */30 * * * * curl ".../api/ai/suggest?action=news-ingest&secret=…"
  if (action === "news-ingest") {
    try {
      const summary = await ingestSources(adminClient());
      res.status(200).json({ ok: true, ...summary });
    } catch (e) {
      console.error("news-ingest error:", e.message);
      res.status(500).json({ error: e.message });
    }
    return;
  }

  // ── Dispatch: World Monitor free-feed ingest (USGS/FIRMS/ACLED; no LLM) ────
  // Triggered by the Pulse "World" view "Refresh now" button (Bearer JWT) or a
  // Hetzner cron (secret): */15 * * * * curl ".../api/ai/suggest?action=world-ingest&secret=…"
  // Natively ingests the FREE feeds worldmonitor aggregates into monitor_events
  // (source_type='geo'); paid APIs have no code path. Free (no LLM, not gated).
  if (action === "world-ingest") {
    try {
      const summary = await ingestWorldEvents(adminClient());
      res.status(200).json({ ok: true, ...summary });
    } catch (e) {
      console.error("world-ingest error:", e.message);
      res.status(500).json({ error: e.message });
    }
    return;
  }

  // ── Dispatch: validate a feed URL for the Pulse "Add source" form ──────────
  // Owner pastes a URL; we report whether it's a usable RSS/Atom feed and, if
  // not, WHY plus verified replacement URLs to paste instead. Free (no LLM).
  if (action === "validate-feed") {
    let feedUrl = req.query?.url || url?.searchParams.get("url");
    if (!feedUrl && req.body) {
      feedUrl = typeof req.body === "string"
        ? (() => { try { return JSON.parse(req.body).url; } catch { return null; } })()
        : req.body.url;
    }
    if (!feedUrl) { res.status(400).json({ ok: false, reason: "No URL provided." }); return; }
    try {
      res.status(200).json(await validateFeedUrl(feedUrl));
    } catch (e) {
      console.error("validate-feed error:", e.message);
      res.status(500).json({ ok: false, reason: e.message });
    }
    return;
  }

  // ── Dispatch: YouTube oEmbed lookup for the Thumbnail DNA capture form ─────
  // Owner pastes a YouTube URL; we fetch youtube.com/oembed server-side and
  // return title/channel/thumbnail for best-effort enrichment. The displayed
  // thumbnail is derived client-side (zero-key) and never blocks on this — so
  // ANY failure returns HTTP 200 { ok:false, reason } (not 500). Folded here to
  // stay under the 12-function cap. Free (no LLM).
  if (action === "youtube-oembed") {
    let ytUrl = req.query?.url || url?.searchParams.get("url");
    if (!ytUrl && req.body) {
      ytUrl = typeof req.body === "string"
        ? (() => { try { return JSON.parse(req.body).url; } catch { return null; } })()
        : req.body.url;
    }
    if (!ytUrl) { res.status(400).json({ ok: false, reason: "No URL provided." }); return; }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(ytUrl)}&format=json`,
        { signal: ctrl.signal });
      if (!r.ok) {
        res.status(200).json({ ok: false, reason: `oEmbed HTTP ${r.status}` });
        return;
      }
      const data = await r.json();
      res.status(200).json({
        ok: true,
        title: data?.title ?? null,
        channel: data?.author_name ?? null,
        thumbnail_url: data?.thumbnail_url ?? null,
      });
    } catch (e) {
      const reason = e.name === "AbortError" ? "oEmbed request timed out" : e.message;
      res.status(200).json({ ok: false, reason });
    } finally {
      clearTimeout(t);
    }
    return;
  }

  // ── Dispatch: YouTube playlist auto-ingest → thumbnail_dna (free, no LLM) ──
  // Triggered by the Thumbnails "↻ Refresh" button (Bearer JWT) or a Hetzner
  // cron (secret): */15 * * * * curl ".../api/ai/suggest?action=yt-sync&secret=…"
  // Polls a public YouTube playlist's Atom feed and inserts each video into
  // thumbnail_dna deduped on video_id (ON CONFLICT DO NOTHING via the FULL
  // unique index thumbnail_dna_video_id_uidx from migration 0067) — so dropping
  // a video into the playlist auto-catalogs it, and the new row arrives live via
  // the existing thumbnail_dna realtime sub. Mirrors news-ingest's shape. Genes
  // stay null (manual-only); DO NOTHING never clobbers a manual gene tag.
  if (action === "yt-sync") {
    const pid = process.env.YT_THUMBNAIL_PLAYLIST_ID;
    if (!pid) {
      res.status(200).json({ ok: true, skipped: true, reason: "YT_THUMBNAIL_PLAYLIST_ID not set" });
      return;
    }
    try {
      // Fetch the playlist Atom feed with an 8s abort (stays well under maxDuration:45).
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      let xml;
      try {
        const r = await fetch(
          `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(pid)}`,
          { signal: ctrl.signal });
        if (!r.ok) throw new Error(`YouTube feed HTTP ${r.status}`);
        xml = await r.text();
      } finally {
        clearTimeout(t);
      }

      const entries = parseYouTubePlaylistFeed(xml);
      if (!entries.length) {
        res.status(200).json({ ok: true, items_seen: 0, inserted: 0 });
        return;
      }

      const rows = entries.map((e) => ({
        platform: "yt",
        source: "yt_playlist",
        video_id: e.videoId,
        video_url: `https://www.youtube.com/watch?v=${e.videoId}`,
        thumbnail_url: `https://i.ytimg.com/vi/${e.videoId}/hqdefault.jpg`,
        title: e.title || null,
        channel: e.channel || null,
      }));

      // ON CONFLICT (video_id) DO NOTHING — never DO UPDATE (must not clobber
      // manual gene tags on an already-captured video). ignoreDuplicates+select
      // returns ONLY freshly-inserted rows.
      const { data, error } = await adminClient()
        .from("thumbnail_dna")
        .upsert(rows, { onConflict: "video_id", ignoreDuplicates: true })
        .select("id");
      if (error) throw new Error(error.message);

      res.status(200).json({ ok: true, items_seen: entries.length, inserted: (data || []).length });
    } catch (e) {
      console.error("yt-sync error:", e.message);
      res.status(500).json({ error: e.message });
    }
    return;
  }

  // ── Dispatch: Discord notification when a reel moves to in_progress ─────────
  // Called from the store's moveStage / sendBack with a Bearer JWT.
  // Reads discord_config from app_settings (owner sets once via Roles Admin).
  // discord_config shape: { mode: "all"|"owner", webhooks: { paul: "url", ... } }
  // Always returns 200 — Discord failures must never surface as app errors.
  if (action === "discord-notify") {
    const body = req.body || {};
    const { reel_id, reel_title, assigned_to, stage, sent_back } = body;
    if (!reel_id || !stage) {
      res.status(400).json({ error: "reel_id and stage required" }); return;
    }
    try {
      const cfgRes = await adminClient()
        .from("app_settings").select("value").eq("key", "discord_config").maybeSingle();
      const cfg = cfgRes.data?.value || {};
      if (!cfg.webhooks) {
        res.status(200).json({ ok: true, skipped: true, reason: "no webhooks configured" }); return;
      }
      // Build recipient set: assignee + always paul + maya on in_progress
      const targets = new Set(["paul", "maya"]);
      if (assigned_to) targets.add(assigned_to);
      const displayTitle = reel_title || reel_id;
      const msg = sent_back
        ? `🔄 **${displayTitle}** was sent back to ${assigned_to || "editor"} for revisions`
        : `▶️ **${displayTitle}** moved to In Progress${assigned_to ? " — assigned to " + assigned_to : ""}`;
      const results = await Promise.allSettled(
        [...targets].filter(t => cfg.webhooks[t]).map(t =>
          fetch(cfg.webhooks[t], {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: msg }),
          })
        )
      );
      const sent = results.filter(r => r.status === "fulfilled").length;
      res.status(200).json({ ok: true, sent, total: [...targets].length });
    } catch (e) {
      console.error("discord-notify error:", e.message);
      res.status(200).json({ ok: true, skipped: true, error: e.message });
    }
    return;
  }

  // ── Dispatch: IG-sync mismatch alert → owner Discord ───────────────────────
  // The Hetzner IG-DM poller POSTs here (authed above by SUGGEST_CRON_SECRET)
  // when a sync run's reconciliation fails, so the owner is pinged with the
  // mismatch count + a by-issue-type breakdown. Reads cfg.webhooks.paul from
  // app_settings.discord_config, same as discord-notify. ALWAYS returns 200 —
  // a Discord failure (or missing webhook) must NEVER break the poller.
  if (action === "ig-sync-alert") {
    const body = req.body || {};
    const { run_id, mismatch_count, issues } = body;
    try {
      const cfgRes = await adminClient()
        .from("app_settings").select("value").eq("key", "discord_config").maybeSingle();
      const cfg = cfgRes.data?.value || {};
      const webhook = cfg.webhooks?.paul;
      if (!webhook) {
        res.status(200).json({ ok: true, skipped: true, reason: "no paul webhook configured" });
        return;
      }
      // Build a concise by-issue-type breakdown. `issues` may be an object map
      // { issue_type: count } OR an array of { issue_type } / { issueType } rows;
      // tolerate both so the poller's exact shape isn't a hard contract.
      let breakdown = "";
      if (issues && typeof issues === "object" && !Array.isArray(issues)) {
        breakdown = Object.entries(issues)
          .map(([k, v]) => `${k}: ${v}`).join(", ");
      } else if (Array.isArray(issues)) {
        const counts = {};
        for (const it of issues) {
          const t = (it && (it.issue_type || it.issueType || it.type)) || "unknown";
          counts[t] = (counts[t] || 0) + 1;
        }
        breakdown = Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(", ");
      }
      const msg =
        `⚠️ **IG DM sync mismatch** — run \`${run_id ?? "?"}\`\n` +
        `Mismatch count: **${mismatch_count ?? "?"}**` +
        (breakdown ? `\nBy issue type: ${breakdown}` : "");
      try {
        await fetch(webhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: msg }),
        });
      } catch (postErr) {
        // Discord post failed — non-fatal, the poller must not see an error.
        res.status(200).json({ ok: true, skipped: true, error: postErr.message });
        return;
      }
      res.status(200).json({ ok: true, sent: true });
    } catch (e) {
      console.error("ig-sync-alert error:", e.message);
      res.status(200).json({ ok: true, skipped: true, error: e.message });
    }
    return;
  }

  // ── Dispatch: submit a render job to the Hetzner render worker ─────────────
  // POST /api/ai/suggest?action=render-submit  (owner Bearer JWT or cron secret)
  // Body: { reel_dna_id?, project_id?, project_json, render_mode? }
  // Fire-and-forget proxy → Hetzner /api/render/submit. Returns { job_id }.
  // The caller polls status via ?action=render-status&id=<job_id> or watches
  // the render_jobs Supabase realtime subscription.
  if (action === "render-submit") {
    // Owner-only gate at the API layer (the Editor UI is permission-gated, but a
    // non-owner with a valid JWT must not be able to queue renders directly).
    try { await verifyOwner(req); }
    catch { res.status(403).json({ error: "Owner only" }); return; }
    const renderSecret = process.env.REEL_DECONSTRUCT_SECRET;
    if (!renderSecret) { res.status(500).json({ error: "REEL_DECONSTRUCT_SECRET not configured" }); return; }
    const body = typeof req.body === "string"
      ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })()
      : (req.body || {});
    if (!body.project_json) { res.status(400).json({ error: "project_json required" }); return; }
    try {
      const r = await fetch(
        `https://api.footagebrain.com/api/render/submit?secret=${encodeURIComponent(renderSecret)}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { res.status(502).json({ error: `Render worker HTTP ${r.status}`, ...data }); return; }
      res.status(200).json({ ok: true, ...data });
    } catch (e) {
      console.error("render-submit error:", e.message);
      res.status(502).json({ error: `Couldn't reach render worker: ${e.message}` });
    }
    return;
  }

  // ── Dispatch: poll a render job's status ────────────────────────────────────
  // GET /api/ai/suggest?action=render-status&id=<job_id>  (owner Bearer JWT)
  // Proxies to Hetzner /api/render/status/{job_id}. Returns { status, progress,
  // output_url (HMAC-signed), error }. output_url is re-minted on every poll.
  if (action === "render-status") {
    try { await verifyOwner(req); }
    catch { res.status(403).json({ error: "Owner only" }); return; }
    const renderSecret = process.env.REEL_DECONSTRUCT_SECRET;
    if (!renderSecret) { res.status(500).json({ error: "REEL_DECONSTRUCT_SECRET not configured" }); return; }
    const jobId = req.query?.id || url?.searchParams.get("id");
    if (!jobId || !/^[0-9a-f-]{36}$/i.test(jobId)) {
      res.status(400).json({ error: "Valid job id required" }); return;
    }
    try {
      const r = await fetch(
        `https://api.footagebrain.com/api/render/status/${encodeURIComponent(jobId)}?secret=${encodeURIComponent(renderSecret)}`);
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { res.status(502).json({ error: `Render worker HTTP ${r.status}`, ...data }); return; }
      res.status(200).json({ ok: true, ...data });
    } catch (e) {
      console.error("render-status error:", e.message);
      res.status(502).json({ error: `Couldn't reach render worker: ${e.message}` });
    }
    return;
  }

  // ── Guard: an unrecognized action must NOT fall through to the daily Claude
  // suggestions run below. That run makes a slow LLM call and on Vercel Hobby
  // (~10s ceiling) it times out into a non-JSON 500 — which is exactly how a
  // not-yet-deployed `ig-sync` surfaced as a bare "IG sync failed (500)".
  if (action) { res.status(400).json({ error: `Unknown action: ${action}` }); return; }

  // ── Kill switch: skip the suggestions run if the owner paused Claude ────────
  if (!(await isAnthropicEnabled())) { res.status(503).json(ANTHROPIC_PAUSED); return; }

  const sb = adminClient();

  // ── Fetch last 7 days of unresolved notes ─────────────────────────────────
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: notes, error: notesErr } = await sb
    .from("ai_notes")
    .select("id, source, topic, tags, body, severity, created_at")
    .eq("resolved", false)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(200);

  if (notesErr) {
    res.status(500).json({ error: notesErr.message });
    return;
  }

  if (!notes || notes.length === 0) {
    res.status(200).json({ suggestions_created: 0, suggestions_skipped: 0, reason: "No unresolved notes in last 7 days" });
    return;
  }

  // ── Build context string (no raw message bodies — just metadata + excerpts) ─
  const grouped = {};
  for (const n of notes) {
    if (!grouped[n.topic]) grouped[n.topic] = [];
    grouped[n.topic].push({
      tags:    n.tags,
      excerpt: (n.body || "").slice(0, 120),
      source:  n.source,
    });
  }

  const contextLines = Object.entries(grouped).map(([topic, items]) =>
    `${topic} (${items.length} occurrences):\n` +
    items.slice(0, 6).map(it =>
      `  - [${it.source}] ${it.excerpt}` + (it.tags?.length ? ` [${it.tags.join(", ")}]` : "")
    ).join("\n")
  );

  const contextText = contextLines.join("\n\n");

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
    return;
  }

  // ── Ask Claude for improvement suggestions ────────────────────────────────
  let suggestions = [];
  try {
    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      system: `You are an operations advisor for a 4-person video production team called FootageBrain.
You analyze recurring patterns in team chat and social media comments to identify workflow improvements.
Return ONLY a JSON array of up to 3 suggestions. No markdown, no text outside JSON. Start with "[".

Each suggestion:
{
  "category": "<workflow | app | content | sop>",
  "title": "<short action-oriented title, max 80 chars>",
  "body": "<2-3 sentence explanation of the issue and recommended fix>",
  "priority": "<low | medium | high>"
}

Categories:
- workflow: how the team coordinates, assigns tasks, or follows processes
- app: the FootageBrain dashboard app — missing features, UX issues, bugs
- content: video content strategy, posting schedules, platform-specific advice
- sop: standard operating procedure gaps — things that need to be documented`,
      messages: [{
        role: "user",
        content: `Here are the recurring themes from team conversations in the last 7 days:\n\n${contextText}\n\nGenerate up to 3 actionable improvement suggestions.`,
      }],
    });

    const raw = message.content?.[0]?.text || "";
    const start = raw.indexOf("[");
    const end   = raw.lastIndexOf("]");
    if (start !== -1 && end !== -1) {
      suggestions = JSON.parse(raw.slice(start, end + 1));
    }
  } catch (e) {
    console.error("suggest LLM error:", e.message);
    res.status(500).json({ error: e.message });
    return;
  }

  if (!suggestions.length) {
    res.status(200).json({ suggestions_created: 0, suggestions_skipped: 0 });
    return;
  }

  // ── Deduplicate against recent suggestions ────────────────────────────────
  const since14 = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data: existing } = await sb
    .from("improvement_suggestions")
    .select("title")
    .gte("created_at", since14);

  const existingTitles = new Set((existing || []).map(s => s.title.toLowerCase().trim()));

  let created = 0;
  let skipped = 0;

  for (const s of suggestions) {
    if (!s.title || !s.body || !s.category) { skipped++; continue; }
    if (existingTitles.has(s.title.toLowerCase().trim())) { skipped++; continue; }

    const { error } = await sb.from("improvement_suggestions").insert({
      category: s.category || "workflow",
      title:    s.title.slice(0, 200),
      body:     s.body.slice(0, 2000),
      priority: s.priority || "medium",
      source_note_ids: notes.slice(0, 10).map(n => n.id),
    });

    if (error) {
      console.error("suggestion insert error:", error.message);
      skipped++;
    } else {
      created++;
    }
  }

  res.status(200).json({ suggestions_created: created, suggestions_skipped: skipped });
}
