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

import { createHmac, randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { adminClient, setCors, isAnthropicEnabled, ANTHROPIC_PAUSED, classifyCaller, verifyOwner } from "../admin/_auth.js";
import { runInsights } from "./_insights-core.js";
import { ingestSources, validateFeedUrl, parseYouTubePlaylistFeed, fetchPlaylistViaDataApi } from "./_rss.js";
import { ingestWorldEvents } from "./_world-feeds.js";
import { pushReelToPlanable, planablePostHasMedia, createPlanableCampaign } from "./_planable.js";
import { searchTracks, getTrack, getDownloadUrl } from "./_epidemic.js";

export const config = { maxDuration: 60 }; // Hobby ceiling — margin for the planable two-step media poll.

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
      // Prefer the YouTube Data API (full playlist, paginated) when YT_API_KEY is
      // set — the public Atom feed below is hard-capped at ~15 videos, so a
      // playlist with more than that never fully syncs via the feed. Fall back to
      // the feed on ANY Data API failure (missing/expired key, quota, private
      // playlist) so a key problem never takes the sync fully offline.
      let entries = [];
      let via = "rss";
      const apiKey = process.env.YT_API_KEY;
      if (apiKey) {
        try {
          entries = await fetchPlaylistViaDataApi(pid, apiKey);
          via = "data_api";
        } catch (apiErr) {
          console.warn("yt-sync data-api failed, falling back to feed:", apiErr.message);
        }
      }

      // Atom feed path: no key configured, OR the Data API failed. ~15-video cap.
      if (via !== "data_api") {
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
        entries = parseYouTubePlaylistFeed(xml);
      }

      if (!entries.length) {
        res.status(200).json({ ok: true, via, items_seen: 0, inserted: 0 });
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

      res.status(200).json({ ok: true, via, items_seen: entries.length, inserted: (data || []).length });
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
    // AUTHENTICATED draft path (owner-approved gate change, pairs with migration
    // 0094 opening render_jobs to authenticated-manage so any signed-in editor can
    // self-serve a DRAFT render). The top-level gate (:61-72) already rejected
    // anonymous callers — a valid Supabase Bearer JWT OR the cron secret is
    // required to reach here — so no extra verifyOwner() is needed. Final/1080p
    // gating is out of scope; existing render_mode handling in `body` is untouched.
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
  // GET /api/ai/suggest?action=render-status&id=<job_id>  (authenticated JWT)
  // Proxies to Hetzner /api/render/status/{job_id}. Returns { status, progress,
  // output_url (HMAC-signed), error }. output_url is re-minted on every poll.
  // AUTHENTICATED draft path (owner-approved, pairs with 0094) — the top-level
  // gate (:61-72) already rejected anonymous; any signed-in editor may poll.
  if (action === "render-status") {
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

  // ── Dispatch: auto-captions (whisper word-timestamps) ──────────────────────
  // POST /api/ai/suggest?action=captions-submit  (authenticated JWT — NOT owner)
  //   Body: { project_id, source_drive_id, language? }
  //   Fire-and-forget proxy → Hetzner edit_ai.py /api/edit/captions/submit.
  //   Returns { ok:true, job_id }. The caller polls ?action=captions-status&id=.
  // The REEL_DECONSTRUCT_SECRET is appended to the upstream URL server-side and
  // NEVER returned to the client. The top-level gate (:61-72) already rejected
  // anonymous — any signed-in team member may reach here (the draft AI path).
  if (action === "captions-submit") {
    const editSecret = process.env.REEL_DECONSTRUCT_SECRET;
    if (!editSecret) { res.status(500).json({ error: "REEL_DECONSTRUCT_SECRET not configured" }); return; }
    const body = typeof req.body === "string"
      ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })()
      : (req.body || {});
    if (!body.source_drive_id) { res.status(400).json({ error: "source_drive_id required" }); return; }
    try {
      const r = await fetch(
        `https://api.footagebrain.com/api/edit/captions/submit?secret=${encodeURIComponent(editSecret)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_id: body.project_id,
            source_drive_id: body.source_drive_id,
            language: body.language,
          }),
        });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { res.status(502).json({ error: `Captions worker HTTP ${r.status}`, ...data }); return; }
      res.status(200).json({ ok: true, ...data });
    } catch (e) {
      console.error("captions-submit error:", e.message);
      res.status(502).json({ error: `Couldn't reach captions worker: ${e.message}` });
    }
    return;
  }

  // ── Dispatch: poll an auto-captions job ────────────────────────────────────
  // GET /api/ai/suggest?action=captions-status&id=<job_id>  (authenticated JWT)
  //   Proxies → Hetzner /api/edit/captions/status/{id}.
  //   Returns { ok:true, status, progress, captions:[{text,startAt,endAt}] }.
  if (action === "captions-status") {
    const editSecret = process.env.REEL_DECONSTRUCT_SECRET;
    if (!editSecret) { res.status(500).json({ error: "REEL_DECONSTRUCT_SECRET not configured" }); return; }
    const jobId = req.query?.id || url?.searchParams.get("id");
    if (!jobId || !/^[0-9a-f-]{36}$/i.test(jobId)) {
      res.status(400).json({ error: "Valid job id required" }); return;
    }
    try {
      const r = await fetch(
        `https://api.footagebrain.com/api/edit/captions/status/${encodeURIComponent(jobId)}?secret=${encodeURIComponent(editSecret)}`);
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { res.status(502).json({ error: `Captions worker HTTP ${r.status}`, ...data }); return; }
      res.status(200).json({ ok: true, ...data });
    } catch (e) {
      console.error("captions-status error:", e.message);
      res.status(502).json({ error: `Couldn't reach captions worker: ${e.message}` });
    }
    return;
  }

  // ── Dispatch: silence/filler cut suggestions ───────────────────────────────
  // POST /api/ai/suggest?action=silence-submit  (authenticated JWT — NOT owner)
  //   Body: { project_id, source_drive_id, options:{silenceDb,minSilenceSec,fillers[]} }
  //   Fire-and-forget proxy → Hetzner /api/edit/silence/submit.
  //   Returns { ok:true, job_id }. The caller polls ?action=silence-status&id=.
  // Secret is server-side only. Anonymous already rejected by the top gate.
  if (action === "silence-submit") {
    const editSecret = process.env.REEL_DECONSTRUCT_SECRET;
    if (!editSecret) { res.status(500).json({ error: "REEL_DECONSTRUCT_SECRET not configured" }); return; }
    const body = typeof req.body === "string"
      ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })()
      : (req.body || {});
    if (!body.source_drive_id) { res.status(400).json({ error: "source_drive_id required" }); return; }
    try {
      const r = await fetch(
        `https://api.footagebrain.com/api/edit/silence/submit?secret=${encodeURIComponent(editSecret)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_id: body.project_id,
            source_drive_id: body.source_drive_id,
            options: body.options,
          }),
        });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { res.status(502).json({ error: `Silence worker HTTP ${r.status}`, ...data }); return; }
      res.status(200).json({ ok: true, ...data });
    } catch (e) {
      console.error("silence-submit error:", e.message);
      res.status(502).json({ error: `Couldn't reach silence worker: ${e.message}` });
    }
    return;
  }

  // ── Dispatch: poll a silence/filler-cut job ────────────────────────────────
  // GET /api/ai/suggest?action=silence-status&id=<job_id>  (authenticated JWT)
  //   Proxies → Hetzner /api/edit/silence/status/{id}. Validates id is a UUID
  //   before proxying (mirrors render-status). On worker 502/timeout returns a
  //   clean { error } with the upstream status — never a raw stack.
  //   Returns { ok:true, status, progress,
  //             suggestedCuts:[{start,end,kind:"silence"|"filler",word?}] }.
  if (action === "silence-status") {
    const editSecret = process.env.REEL_DECONSTRUCT_SECRET;
    if (!editSecret) { res.status(500).json({ error: "REEL_DECONSTRUCT_SECRET not configured" }); return; }
    const jobId = req.query?.id || url?.searchParams.get("id");
    if (!jobId || !/^[0-9a-f-]{36}$/i.test(jobId)) {
      res.status(400).json({ error: "Valid job id required" }); return;
    }
    try {
      const r = await fetch(
        `https://api.footagebrain.com/api/edit/silence/status/${encodeURIComponent(jobId)}?secret=${encodeURIComponent(editSecret)}`);
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { res.status(502).json({ error: `Silence worker HTTP ${r.status}`, ...data }); return; }
      res.status(200).json({ ok: true, ...data });
    } catch (e) {
      console.error("silence-status error:", e.message);
      res.status(502).json({ error: `Couldn't reach silence worker: ${e.message}` });
    }
    return;
  }

  // ── Dispatch: read-only Planable config for the Export-tab selector/preview ─
  // GET /api/ai/suggest?action=planable-config  (owner Bearer JWT only)
  // Returns the UI-safe shape derived from app_settings.planable_config. The
  // Planable API TOKEN (PLANABLE_API_TOKEN) is NEVER read or returned here — only
  // workspace/scheduling metadata and the per-platform page allow-list as booleans.
  if (action === "planable-config") {
    try { await verifyOwner(req); }
    catch { res.status(403).json({ error: "Owner only" }); return; }
    try {
      const sb = adminClient();
      const { data: cfgRow, error: cfgErr } = await sb
        .from("app_settings")
        .select("value")
        .eq("key", "planable_config")
        .maybeSingle();
      if (cfgErr) { res.status(500).json({ error: cfgErr.message }); return; }
      const cfg = cfgRow?.value;
      if (!cfg || typeof cfg !== "object") {
        // Not configured yet — report unconfigured rather than erroring so the UI
        // can show a "set up Planable" state. Token presence is irrelevant here.
        res.status(200).json({ configured: false, platforms: [] });
        return;
      }
      const pages = (cfg.pages && typeof cfg.pages === "object") ? cfg.pages : {};
      const handles = (cfg.handles && typeof cfg.handles === "object") ? cfg.handles : {};
      // Surface every platform that has a mapped page (the allow-list). Never
      // expose the raw page id — only a hasPage boolean + an optional handle.
      const platforms = Object.keys(pages)
        .filter((k) => pages[k])
        .map((k) => {
          const p = { key: k, hasPage: true };
          if (handles[k]) p.handle = String(handles[k]);
          return p;
        });
      res.status(200).json({
        configured: true,
        workspaceId: cfg.workspaceId || cfg.workspace_id || undefined,
        defaultTime: cfg.defaultTime || cfg.default_time || undefined,
        timezone: cfg.timezone || cfg.tz || undefined,
        platforms,
      });
    } catch (e) {
      console.error("planable-config error:", e.message);
      res.status(500).json({ error: e.message });
    }
    return;
  }

  // ── Dispatch: push posted reels to Planable as scheduled DRAFT posts ─────────
  // POST /api/ai/suggest?action=planable-push  (owner Bearer JWT only)
  // Body: { platforms:string[], force?, items:[{ reelId, caption, title?, scheduled,
  //         mediaPath?, mediaUrl?, renderJobId? }] }
  // Returns 200 { ok:true, campaignId?:string|null, campaignWarning?:string,
  //              results:[{ reelId, ok, planablePostId?, groupId?, withMedia?, skipped?, error? }] }
  //
  // SEMANTICS: ONE Planable campaign per call bundles ALL reels; EACH reel = ONE
  // grouped post fanned across the selected platforms' pageIds (its own groupId);
  // each reel uses its OWN item.scheduled (assigned date + posting time).
  //
  // CROSS-POSTING GUARD (over the ARRAY): pageIds are resolved SERVER-SIDE from the
  // app_settings.planable_config allow-list (config.pages[platform]); the client may
  // send only platform KEYS and any raw page id it sends is ignored. Empty / unmapped /
  // >20 platforms are a 400 — this allow-list is the guard for the shared Planable
  // workspace.
  if (action === "planable-push") {
    // Owner-only gate at the API layer (the Export UI is permission-gated, but a
    // non-owner with a valid JWT must not be able to push to the shared workspace).
    try { await verifyOwner(req); }
    catch { res.status(403).json({ error: "Owner only" }); return; }

    const planableToken = process.env.PLANABLE_API_TOKEN;
    if (!planableToken) { res.status(500).json({ error: "PLANABLE_API_TOKEN not configured" }); return; }

    const sb = adminClient();

    // Load the Planable config (workspace + page allow-list) server-side.
    const { data: cfgRow, error: cfgErr } = await sb
      .from("app_settings")
      .select("value")
      .eq("key", "planable_config")
      .maybeSingle();
    if (cfgErr) { res.status(500).json({ error: cfgErr.message }); return; }
    const config = cfgRow?.value;
    if (!config || typeof config !== "object") {
      res.status(500).json({ error: "planable_config not set in app_settings" }); return;
    }

    const body = typeof req.body === "string"
      ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })()
      : (req.body || {});
    const platforms = Array.isArray(body.platforms) ? body.platforms : [];
    const force = body.force === true;
    const items = Array.isArray(body.items) ? body.items : [];

    // CROSS-POSTING GUARD over the ARRAY: resolve EACH platform key to its page id from
    // the server-side allow-list. The client may pass only KEYS; any raw page id it
    // sends is ignored (we never look at the client's ids — only at config.pages[key]).
    // Reject: empty platforms, any unmapped platform key, or >20 / <1 resolved pages.
    const pages = (config.pages && typeof config.pages === "object") ? config.pages : {};
    if (platforms.length === 0) {
      res.status(400).json({ error: "platforms required (non-empty array of keys)" }); return;
    }
    const unmapped = platforms.filter((p) => typeof p !== "string" || !pages[p]);
    if (unmapped.length > 0) {
      res.status(400).json({ error: `Unmapped platform(s): ${unmapped.join(", ")}` }); return;
    }
    const pageIds = platforms.map((p) => pages[p]);
    if (pageIds.length < 1 || pageIds.length > 20) {
      res.status(400).json({ error: `pageIds must be 1..20 (got ${pageIds.length})` }); return;
    }
    const workspaceId = config.workspaceId || config.workspace_id;
    if (!workspaceId) {
      res.status(500).json({ error: "planable_config missing workspaceId" }); return;
    }

    // The platform-set string recorded on EACH reel's row (one row per reel).
    const platformsCsv = platforms.join(",");

    // One batch id ties every reel row from THIS call together (audit + re-query).
    const batchId = randomUUID();

    // Resolve the caller's person id for the pushed_by audit column. verifyOwner
    // already proved this is the owner; we don't re-throw if the lookup is empty.
    let pushedBy = null;
    try {
      const callerToken = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
      if (callerToken) {
        const { data: { user } } = await sb.auth.getUser(callerToken);
        if (user) {
          const { data: person } = await sb
            .from("people")
            .select("id")
            .eq("user_id", user.id)
            .maybeSingle();
          pushedBy = person?.id || null;
        }
      }
    } catch { /* non-fatal — pushed_by is nullable */ }

    // ── ONE campaign per call bundles ALL reels ──────────────────────────────────
    // Open-decision default (reconciled): on POST /campaigns failure the push PROCEEDS
    // campaign-less (campaignId=null) and returns a top-level campaignWarning — a
    // transient /campaigns outage must NEVER drop an entire batch of drafts. Each reel
    // still groups across its pages via its own groupId; only the cross-reel bundle is
    // lost. We do this ONE extra round-trip up-front; the budget accounts for it.
    let campaignId = null;
    let campaignWarning;
    {
      const campaignName = `FootageBrain push ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
      const camp = await createPlanableCampaign({ workspaceId, name: campaignName, token: planableToken });
      if (camp && camp.ok && camp.campaignId) {
        campaignId = camp.campaignId;
      } else {
        campaignId = null;
        campaignWarning = `campaign-less: ${camp?.error || "campaign create failed"}`;
        console.warn(`[planable-push] proceeding campaign-less — ${campaignWarning}`);
      }
    }

    // HARD media-poll budget: the handler must return before Vercel kills it at
    // maxDuration (60s). The campaign create above is one extra round-trip, so the
    // budget is 45s (was 50s) to keep ~15s headroom for that + the post calls.
    // Threaded into pushReelToPlanable so a slow/un-ingestable video degrades to a
    // text-only draft instead of a killed request (the "failed · network error" bug).
    const pushDeadlineMs = Date.now() + 45_000;

    // Platforms where a video is mandatory: a caption-only draft is NOT useful, so
    // a reel with no resolvable public video is reported ok:false instead. Applied
    // when ANY selected platform is video-first.
    const VIDEO_FIRST = new Set(["ig", "tiktok", "yt"]);
    const anyVideoFirst = platforms.some((p) => VIDEO_FIRST.has(p));
    const renderSecret = process.env.REEL_DECONSTRUCT_SECRET;
    const HTTP_RE = /^https?:\/\//i;
    const UUID_RE = /^[0-9a-f-]{36}$/i;

    // MEDIA RESOLUTION (server-side, per the reconciled finding): there is NO
    // reliable DB join from a pipeline reel to a render_jobs row, so resolution is:
    //   (1) render_jobs path — OPT-IN ONLY: active iff the client passes an explicit
    //       valid renderJobId. Re-mint a FRESH HMAC-signed url by REUSING the
    //       existing render-status mechanism (the same Hetzner endpoint the
    //       ?action=render-status branch above proxies) — we do NOT duplicate the
    //       HMAC secret/logic, only call the endpoint and read its re-minted url.
    //   (2) mediaPath path (NEW, PREFERRED) — the owner-uploaded FINAL video lives in
    //       the "reel-videos" Supabase Storage bucket. When the client passes a
    //       non-empty mediaPath, mint a FRESH SHORT-LIVED SIGNED url server-side
    //       (createSignedUrl), so Planable's two-step ingest fetches a valid url. We
    //       record media_path on success so the cleanup cron can delete the source
    //       file once Planable has ingested it.
    //   (3) DEMOTED: a bare client item.mediaUrl (the attachUrl Frame.io/Drive link)
    //       is NOT a real uploaded final video — it MUST NOT be fed into Planable's
    //       media array (those links aren't public downloadable MP4s). Only an
    //       uploaded final (renderJobId/mediaPath) attaches; a bare attachUrl pushes
    //       the draft TEXT-ONLY.
    //   (4) else null.
    // Returns { url, fromPath } — fromPath is the bucket path to persist when the
    // signed-url path produced the media (so cleanup can find + remove the object).
    // RISK: the signed-URL TTL is short; if Planable's async ingest somehow lags past
    // the TTL the fetch could 404 — the two-step poll happens promptly, and the
    // cleanup cron only deletes AFTER confirmed ingestion, so the file is never lost
    // prematurely. Flagged to render/Hetzner owners (deferredRisks).
    const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1h — short-lived; minted fresh per push.
    async function resolveMediaUrl(item) {
      // (1) render_jobs path — opt-in via explicit renderJobId.
      if (renderSecret && item.renderJobId && UUID_RE.test(String(item.renderJobId))) {
        try {
          const r = await fetch(
            `https://api.footagebrain.com/api/render/status/${encodeURIComponent(item.renderJobId)}?secret=${encodeURIComponent(renderSecret)}`);
          const d = await r.json().catch(() => ({}));
          if (r.ok && d && d.status === "done" && d.output_url && HTTP_RE.test(String(d.output_url))) {
            return { url: String(d.output_url), fromPath: null };
          }
        } catch { /* fall through to the next resolution step */ }
      }
      // (2) mediaPath path (PREFERRED) — fresh short-lived signed url from reel-videos.
      if (item.mediaPath && typeof item.mediaPath === "string" && item.mediaPath.trim()) {
        const mediaPath = item.mediaPath.trim();
        try {
          const { data: signed, error: signErr } = await sb
            .storage
            .from("reel-videos")
            .createSignedUrl(mediaPath, SIGNED_URL_TTL_SECONDS);
          if (!signErr && signed && signed.signedUrl && HTTP_RE.test(String(signed.signedUrl))) {
            return { url: String(signed.signedUrl), fromPath: mediaPath };
          }
        } catch { /* fall through to the client candidate */ }
      }
      // (3) DEMOTED — a bare item.mediaUrl (attachUrl) is NOT media-eligible; deliberately
      // NOT returned here so the reel pushes text-only rather than attaching a
      // non-downloadable Frame.io/Drive link.
      // (4) none.
      return { url: null, fromPath: null };
    }

    // ── Per REEL, in parallel; one failure never aborts the batch (allSettled) ───
    // Each reel = ONE pushReelToPlanable call with the SAME pageIds array → its own
    // grouped post/groupId, all sharing the one campaignId.
    const settled = await Promise.allSettled(items.map(async (item) => {
      const reelId = item && item.reelId;
      if (!reelId) return { reelId: reelId || null, ok: false, error: "missing reelId" };

      // Idempotency (REEL axis, not (reel,platform)): unless force, skip a reel already
      // pushed in this campaign-style batch. We dedupe on reel_id alone — a reel now
      // fans across all selected platforms in ONE grouped post, so the old per-platform
      // axis no longer applies.
      if (!force) {
        const { data: existing, error: dErr } = await sb
          .from("planable_pushes")
          .select("id")
          .eq("reel_id", reelId)
          .limit(1);
        if (!dErr && existing && existing.length > 0) {
          return { reelId, ok: true, skipped: true };
        }
      }

      // Resolve the best public video URL server-side. `fromPath` is set only when
      // the owner-uploaded final video (reel-videos bucket) produced the url — that's
      // the value cleanup needs to delete the source object after Planable ingests.
      // A bare attachUrl is DEMOTED (not media) so it never attaches a non-MP4 link.
      const tStart = Date.now();
      const { url: mediaUrl, fromPath: mediaPath } = await resolveMediaUrl(item);
      if (!mediaUrl && anyVideoFirst) {
        return { reelId, ok: false, error: "no public video available for a video-first platform" };
      }

      // Build this reel's platform-specific titles from its OWN item.title, gated by
      // whether the matching platform is in the selected set.
      const titles = {};
      if (item.title != null && String(item.title).trim() !== "") {
        if (platforms.includes("yt"))        titles.youtubeTitle       = item.title;
        if (platforms.includes("linkedin"))  titles.linkedinVideoTitle = item.title;
        if (platforms.includes("pinterest")) titles.pinterestTitle     = item.title;
      }

      const pushRes = await pushReelToPlanable({
        token: planableToken,
        workspaceId,
        pageIds,
        text: item.caption || "",
        scheduledAt: item.scheduled,
        mediaUrls: mediaUrl ? [mediaUrl] : undefined,
        titles,
        campaignId: campaignId || undefined,
        deadlineMs: pushDeadlineMs,
      });
      // Timing breadcrumb — surfaces in Vercel runtime logs which reel/step was slow.
      console.log(`[planable-push] reel=${reelId} platforms=${platformsCsv} media=${mediaUrl ? "y" : "n"} withMedia=${pushRes.withMedia === true} ms=${Date.now() - tStart}`);
      if (!pushRes.ok) {
        return { reelId, ok: false, error: pushRes.error || "Planable push failed" };
      }

      // Record ONE row per reel (audit + idempotency). Columns:
      // [reel_id, platform, planable_post_id, scheduled, with_media, media_path,
      //  pushed_by, campaign_id, group_id, page_ids, batch_id] (+ media_deleted_at NULL).
      // platform = the platforms CSV; media_path is recorded ONLY when the media came
      // from the reel-videos bucket AND it actually attached (withMedia) — so the
      // cleanup cron never targets a file for a draft that went up text-only.
      const recordMediaPath = (mediaPath && pushRes.withMedia === true) ? mediaPath : null;
      const { error: insErr } = await sb.from("planable_pushes").insert({
        reel_id: reelId,
        platform: platformsCsv,
        planable_post_id: pushRes.postId || null,
        scheduled: item.scheduled || null,
        with_media: pushRes.withMedia === true,
        media_path: recordMediaPath,
        pushed_by: pushedBy,
        campaign_id: campaignId,
        group_id: pushRes.groupId || null,
        page_ids: pageIds,
        batch_id: batchId,
        media_deleted_at: null,
      });
      if (insErr) {
        // The draft went up in Planable but we couldn't record it — surface it but
        // still mark ok so the human knows the draft exists.
        return { reelId, ok: true, planablePostId: pushRes.postId || null,
                 groupId: pushRes.groupId || null, withMedia: pushRes.withMedia === true,
                 error: `recorded-failed: ${insErr.message}` };
      }
      return { reelId, ok: true, planablePostId: pushRes.postId || null,
               groupId: pushRes.groupId || null, withMedia: pushRes.withMedia === true };
    }));

    const results = settled.map((s, i) =>
      s.status === "fulfilled"
        ? s.value
        : { reelId: (items[i] && items[i].reelId) || null, ok: false, error: String(s.reason?.message || s.reason || "push error") });

    res.status(200).json({ ok: true, campaignId, ...(campaignWarning ? { campaignWarning } : {}), results });
    return;
  }

  // ── Dispatch: post-ingest cleanup of uploaded source videos ──────────────────
  // POST /api/ai/suggest?action=planable-cleanup  (cron SECRET in query OR owner JWT)
  // Hetzner cron (secret): 0 */6 * * * curl ".../api/ai/suggest?action=planable-cleanup&secret=…"
  // For every planable_pushes row that still references a source object in the
  // reel-videos bucket (media_path set, with_media=true, planable_post_id present,
  // not yet deleted), CONFIRM Planable has fully ingested the post's media, then
  // delete the storage object and stamp media_deleted_at. We NEVER delete a file
  // whose ingestion is unconfirmed (planablePostHasMedia must return ingested:true).
  // One row's failure never aborts the batch (allSettled).
  if (action === "planable-cleanup") {
    // Auth: the top-level gate already required EITHER the cron secret (SUGGEST_CRON_SECRET
    // in the query) OR a valid Bearer JWT. For this storage-mutating action a NON-cron
    // caller must additionally be the OWNER — a plain authenticated JWT is not enough.
    const secretAuthed = !!secret && secret === process.env.SUGGEST_CRON_SECRET;
    if (!secretAuthed) {
      try { await verifyOwner(req); }
      catch { res.status(403).json({ error: "Owner only" }); return; }
    }

    const planableToken = process.env.PLANABLE_API_TOKEN;
    if (!planableToken) { res.status(500).json({ error: "PLANABLE_API_TOKEN not configured" }); return; }

    const sb = adminClient();

    // Candidate rows: an uploaded source object still present, attached with media, with
    // a Planable post to confirm against, not yet cleaned up.
    const { data: rows, error: selErr } = await sb
      .from("planable_pushes")
      .select("id, planable_post_id, media_path")
      .not("media_path", "is", null)
      .is("media_deleted_at", null)
      .eq("with_media", true)
      .not("planable_post_id", "is", null);
    if (selErr) { res.status(500).json({ error: selErr.message }); return; }

    const candidates = Array.isArray(rows) ? rows : [];
    let deleted = 0;
    let skipped = 0;
    const errors = [];

    const settled = await Promise.allSettled(candidates.map(async (row) => {
      // CONFIRM ingestion BEFORE any delete — the safe default (ingested:false) keeps
      // the file so a transient/unverified check just retries next run.
      const check = await planablePostHasMedia({ token: planableToken, postId: row.planable_post_id });
      if (!check || check.ok !== true || check.ingested !== true) {
        skipped++;
        return; // try again next run; never delete on an unconfirmed ingest.
      }

      // Ingested → delete the source object, then stamp the row.
      const { error: rmErr } = await sb.storage.from("reel-videos").remove([row.media_path]);
      if (rmErr) {
        errors.push({ id: row.id, error: rmErr.message });
        return; // leave media_deleted_at NULL so a later run retries the delete.
      }
      const { error: updErr } = await sb
        .from("planable_pushes")
        .update({ media_deleted_at: new Date().toISOString() })
        .eq("id", row.id);
      if (updErr) {
        // The object is gone but the stamp failed; surface it. Next run will see the
        // object already removed (remove() is idempotent) and re-stamp.
        errors.push({ id: row.id, error: `deleted-but-unstamped: ${updErr.message}` });
        deleted++;
        return;
      }
      deleted++;
    }));

    // allSettled never rejects, but capture any unexpected rejection defensively.
    for (let i = 0; i < settled.length; i++) {
      if (settled[i].status === "rejected") {
        const r = settled[i].reason;
        errors.push({ id: candidates[i]?.id || null, error: String(r?.message || r || "cleanup error") });
      }
    }

    res.status(200).json({ ok: true, checked: candidates.length, deleted, skipped, errors });
    return;
  }

  // ── Dispatch: report where the UI should upload the final video ──────────────
  // GET /api/ai/suggest?action=planable-upload-target  (owner Bearer JWT only)
  // Capacity-aware: the UI uploads to the reel-videos Supabase bucket by default;
  // only near ~80% of the configured quota does it switch to the (human-gated)
  // Hetzner upload seam. Best-effort measurement — if usage can't be measured we
  // default to supabase + capacityPct:null + a message (never a silent failure).
  if (action === "planable-upload-target") {
    try { await verifyOwner(req); }
    catch { res.status(403).json({ error: "Owner only" }); return; }

    const sb = adminClient();
    const HETZNER_SWITCH_PCT = 80; // switch to the Hetzner seam at/above this %.
    // Quota (bytes) the reel-videos bucket is measured against. Configurable via env
    // so the owner can right-size it without a code change; defaults to 1 GiB.
    const quotaBytes = Number(process.env.PLANABLE_BUCKET_QUOTA_BYTES) || (1 * 1024 * 1024 * 1024);

    // Best-effort usage measurement: sum object sizes in the reel-videos bucket via
    // the Storage list API (metadata.size). This is approximate (top-level listing,
    // capped page) and degrades gracefully — any failure → unmeasurable.
    let usedBytes = null;
    try {
      const { data: objs, error: listErr } = await sb
        .storage
        .from("reel-videos")
        .list("", { limit: 1000, sortBy: { column: "name", order: "asc" } });
      if (!listErr && Array.isArray(objs)) {
        usedBytes = objs.reduce((sum, o) => {
          const size = o && o.metadata && Number(o.metadata.size);
          return sum + (Number.isFinite(size) ? size : 0);
        }, 0);
      }
    } catch { /* unmeasurable — fall through to the default below */ }

    if (usedBytes === null || !Number.isFinite(quotaBytes) || quotaBytes <= 0) {
      // RISK: capacity is unmeasurable (Storage list failed, or no quota configured).
      // Default to supabase + flag it so the UI can surface that capacity is unknown.
      res.status(200).json({
        target: "supabase",
        bucket: "reel-videos",
        capacityPct: null,
        message: "Storage capacity could not be measured; defaulting to Supabase upload. Set PLANABLE_BUCKET_QUOTA_BYTES and ensure the reel-videos bucket is listable.",
      });
      return;
    }

    const capacityPct = Math.round((usedBytes / quotaBytes) * 1000) / 10; // 1-decimal %.
    if (capacityPct >= HETZNER_SWITCH_PCT) {
      // ── Hetzner upload seam (HUMAN-GATED, NOT live) ──────────────────────────
      // Near capacity the UI should upload to the Hetzner backend (the file holder,
      // no body cap) instead of the Supabase bucket. That upload endpoint does NOT
      // exist yet — mirroring the bytes-mode Hetzner seam in api/ai/_planable.js,
      // this is a CLEARLY-COMMENTED seam the UI surfaces (never a silent failure).
      // TODO(hetzner): build a POST upload endpoint on api.footagebrain.com that
      // stores the final MP4 and returns a path/url the push can attach, then wire
      // the UI's 'hetzner' branch to it.
      res.status(200).json({
        target: "hetzner",
        bucket: "reel-videos",
        capacityPct,
        message: `Supabase storage is at ~${capacityPct}% of quota. The Hetzner upload fallback is not yet wired (human-gated backend work) — uploads should pause or the quota be raised.`,
      });
      return;
    }

    res.status(200).json({ target: "supabase", bucket: "reel-videos", capacityPct });
    return;
  }

  // ── Dispatch: Epidemic Sound music library (proxy) ─────────────────────────
  // Server-side proxy so the owner's Epidemic token (read ONLY inside _epidemic.js
  // from process.env.EPIDEMIC_TOKEN) NEVER reaches the browser. The top-level
  // Bearer-JWT auth (above, :60-71) is the gate — NO verifyOwner here, because the
  // 3 editors must be able to search/preview/download licensed tracks. Folded into
  // this route (underscore helper does not count) to stay under the 12-function cap.
  // Frozen contract:
  //   epidemic-search   { term, limit?, offset?, filters?:{moods?[],genres?[]} } -> { ok:true, tracks }
  //   epidemic-track    { id }                                                   -> { ok:true, track }
  //   epidemic-download { id, format?:'mp3'|'wav', quality? }                    -> { ok:true, url, expires }
  // Errors: 500 'EPIDEMIC_TOKEN not configured' (env missing); 502 'epidemic_token_expired'
  // (Epidemic 401/403 → UI "reconnect — see Paul"); 502 { error } otherwise.
  // The token NEVER appears in any response; the signed CDN url is short-lived.
  if (action === "epidemic-search" || action === "epidemic-track" || action === "epidemic-download") {
    if (!process.env.EPIDEMIC_TOKEN) {
      res.status(500).json({ error: "EPIDEMIC_TOKEN not configured" });
      return;
    }
    // Tolerant body parse (mirrors the other proxy branches, e.g. :251-253).
    const body = typeof req.body === "string"
      ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })()
      : (req.body || {});

    let result;
    if (action === "epidemic-search") {
      result = await searchTracks({
        term: body.term,
        limit: body.limit,
        offset: body.offset,
        filters: body.filters,
      });
    } else if (action === "epidemic-track") {
      result = await getTrack(body.id);
    } else {
      result = await getDownloadUrl(body.id, { format: body.format, quality: body.quality });
    }

    if (result && result.expired) {
      res.status(502).json({ error: "epidemic_token_expired" });
      return;
    }
    if (!result || !result.ok) {
      res.status(502).json({ error: (result && result.error) || "epidemic upstream failed" });
      return;
    }

    if (action === "epidemic-search") {
      res.status(200).json({ ok: true, tracks: result.tracks });
    } else if (action === "epidemic-track") {
      res.status(200).json({ ok: true, track: result.track });
    } else {
      res.status(200).json({ ok: true, url: result.url, expires: result.expires });
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
