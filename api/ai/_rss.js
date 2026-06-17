/**
 * News-monitor ingest engine (shared module — not a route; underscore-prefixed so
 * Vercel does not count it as a serverless function, keeping us under the 12-cap).
 *
 * Invoked by api/ai/suggest.js when ?action=news-ingest (auth done by the caller).
 * Flow: read enabled monitor_sources -> fetch each RSS/Atom feed -> parse the
 * latest items -> skip ones already stored -> classify the new ones with the free
 * OpenRouter chain (falling back to the source's defaults on any LLM failure) ->
 * upsert into monitor_events as source_type='poller' (dedup via the partial unique
 * index on (source_type, external_id)) -> write last_fetched_at/last_status/
 * item_count back to the source.
 *
 * Zero-dependency XML parsing (no rss-parser / fast-xml-parser): the feeds we watch
 * are well-formed RSS 2.0 or Atom, and a focused parser keeps the serverless bundle
 * small and avoids an extra install. Classification mirrors api/ai/_insights-core.js.
 */

const MAX_SOURCES   = 25;   // safety cap per run (owner curates "a few" feeds)
const ITEMS_PER_FEED = 15;  // newest N entries considered per feed
const FETCH_TIMEOUT_MS = 7000;
const RETENTION_DAYS = 60;  // auto-pruned: poller rows older than this are dropped
const UA = "FootageBrainNewsMonitor/1.0 (+https://footagebrain.com)";

// Gemini Flash first (best free quality), then the shared free fallback chain.
const OR_MODELS = [
  "google/gemini-2.0-flash-exp:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "z-ai/glm-4.5-air:free",
  "qwen/qwen3-next-80b-a3b-instruct:free",
];

const VALID_CATEGORY = ["algo", "news"];
const VALID_SEVERITY = ["info", "watch", "high"];

const SYSTEM = `You are a classifier for a video-production team's News Monitor.
You receive a JSON array of feed items. Return ONLY a JSON array — no markdown, no
prose outside JSON. Start with "[". For EACH input item return one object:
{
  "i": <the i from the input>,
  "category": "algo" | "news",
  "platform": "instagram" | "tiktok" | "youtube" | "facebook" | "x" | null,
  "severity": "info" | "watch" | "high",
  "summary": "<one sentence, <=300 chars>",
  "tags": ["<tag1>", "<tag2>"]
}
Rules:
- category=algo if the item changes how a platform's algorithm, monetisation, ranking,
  or creator tools work. Otherwise category=news (world / political / general).
- severity=high only for blocking/major shifts (account-wide policy changes, outages,
  breaking world news affecting production). severity=watch for material changes worth
  a glance. severity=info for routine announcements/FYIs.
- platform: only when the item is about a specific platform; otherwise null.
- tags: 0-3 short kebab-case labels ("reels-ranking", "monetization", "elections", ...).
Return one object per input item, same "i". Start with "[".`;

// ── HTTP ──────────────────────────────────────────────────────────────────────
async function fetchText(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": UA, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

// ── XML helpers (zero-dep) ──────────────────────────────────────────────────────
function decodeEntities(s) {
  if (!s) return "";
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")              // strip any nested HTML tags
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&")
    .trim();
}

function firstTag(block, names) {
  for (const name of names) {
    // <tag ...>value</tag>
    const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
    if (m && m[1] != null && decodeEntities(m[1])) return decodeEntities(m[1]);
  }
  return "";
}

// Atom links carry the URL in an href attribute; prefer rel="alternate".
function atomLink(block) {
  const links = [...block.matchAll(/<link\b([^>]*)\/?>(?:<\/link>)?/gi)].map(m => m[1]);
  if (!links.length) return "";
  const pick = links.find(a => /rel=["']?alternate/i.test(a)) || links.find(a => !/rel=/i.test(a)) || links[0];
  const href = pick.match(/href=["']([^"']+)["']/i);
  return href ? decodeEntities(href[1]) : "";
}

function toIso(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Parse RSS 2.0 <item> or Atom <entry> into normalized items, newest first.
 * Returns: [{ externalId, title, summary, link, publishedAt }]
 */
export function parseFeed(xml) {
  if (!xml) return [];
  const isAtom = /<feed[\s>]/i.test(xml) && /<entry[\s>]/i.test(xml);
  const tag = isAtom ? "entry" : "item";
  const blocks = [...xml.matchAll(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`, "gi"))].map(m => m[0]);
  const items = [];
  for (const block of blocks) {
    const title = firstTag(block, ["title"]);
    const link  = isAtom ? atomLink(block) : firstTag(block, ["link"]);
    const guid  = firstTag(block, isAtom ? ["id"] : ["guid"]) || link;
    const summary = firstTag(block, ["description", "summary", "content:encoded", "content"]);
    const pub = firstTag(block, isAtom ? ["published", "updated"] : ["pubDate", "dc:date"]);
    if (!title && !guid) continue;
    items.push({
      externalId: (guid || link || title).slice(0, 500),
      title: (title || "(untitled)").slice(0, 500),
      summary: summary.slice(0, 1000),
      link,
      publishedAt: toIso(pub),
    });
  }
  return items.slice(0, ITEMS_PER_FEED);
}

// ── Classification (free OpenRouter chain; mirrors _insights-core.js) ────────────
async function callOpenRouter(key, userMessage) {
  let lastErr = null;
  for (const model of OR_MODELS) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://footagebrain.com",
          "X-Title": "FootageBrain News Monitor",
        },
        body: JSON.stringify({
          model,
          reasoning: { enabled: false },
          max_tokens: 1800,
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: userMessage },
          ],
        }),
      });
      if (res.status === 404 || res.status === 429 || res.status === 503) {
        lastErr = new Error(`OR ${res.status} for ${model}`); continue;
      }
      if (!res.ok) throw new Error(`OR ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || "";
      if (!text.trim()) { lastErr = new Error(`OR empty from ${model}`); continue; }
      return text;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("All OpenRouter free models failed");
}

function extractJsonArray(text) {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("No JSON array in LLM response");
  return JSON.parse(text.slice(start, end + 1));
}

/**
 * Classify new items for one source. Returns a Map<index, {category, platform,
 * severity, summary, tags}>. On any failure returns an empty Map so the caller
 * falls back to the source's defaults (an unclassified row beats a dropped event).
 */
async function classifyItems(items, orKey) {
  const out = new Map();
  if (!orKey || !items.length) return out;
  const payload = JSON.stringify(items.map((it, i) => ({
    i, title: it.title, summary: (it.summary || "").slice(0, 400),
  })));
  try {
    const parsed = extractJsonArray(await callOpenRouter(orKey, payload));
    for (const p of parsed) {
      const i = Number(p?.i);
      if (!Number.isInteger(i) || i < 0 || i >= items.length) continue;
      out.set(i, {
        category: VALID_CATEGORY.includes(p.category) ? p.category : null,
        platform: typeof p.platform === "string" && p.platform ? p.platform : null,
        severity: VALID_SEVERITY.includes(p.severity) ? p.severity : null,
        summary: typeof p.summary === "string" ? p.summary.slice(0, 500) : null,
        tags: Array.isArray(p.tags) ? p.tags.slice(0, 3).map(String) : [],
      });
    }
  } catch (e) {
    console.warn("news-ingest classify failed (using source defaults):", e.message);
  }
  return out;
}

// ── Per-source pipeline ─────────────────────────────────────────────────────────
async function ingestOne(sb, source, orKey) {
  const items = parseFeed(await fetchText(source.url));
  if (!items.length) return 0;

  // Skip items already stored (saves LLM calls; the unique index is the real guard).
  const ids = items.map(it => it.externalId);
  const { data: existing } = await sb
    .from("monitor_events")
    .select("external_id")
    .eq("source_type", "poller")
    .in("external_id", ids);
  const seen = new Set((existing || []).map(r => r.external_id));
  const fresh = items.filter(it => !seen.has(it.externalId));
  if (!fresh.length) return 0;

  const cls = await classifyItems(fresh, orKey);
  const rows = fresh.map((it, i) => {
    const c = cls.get(i) || {};
    return {
      source_type: "poller",
      external_id: it.externalId,
      category: c.category ?? source.category,
      platform: c.platform ?? source.platform ?? null,
      severity: c.severity ?? source.severity_default,
      status: "new",
      starred: false,
      title: it.title,
      summary: (c.summary ?? it.summary ?? "").slice(0, 500) || null,
      source_name: source.name,
      source_url: it.link || source.url,
      region: source.region ?? null,
      tags: c.tags ?? [],
      published_at: it.publishedAt,
      created_by: null,
    };
  });

  // ignoreDuplicates -> .select() returns only the newly inserted rows.
  const { data: inserted, error } = await sb
    .from("monitor_events")
    .upsert(rows, { onConflict: "source_type,external_id", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(error.message);
  return (inserted || []).length;
}

/**
 * Retention: keep the table bounded by deleting auto-ingested (poller) rows
 * older than RETENTION_DAYS. Starred rows are kept (the owner flagged them), and
 * manual/vault rows are never touched. Best-effort — a prune failure must not
 * fail the ingest. Returns the number of rows removed.
 */
async function pruneOld(sb) {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  try {
    const { data, error } = await sb
      .from("monitor_events")
      .delete()
      .eq("source_type", "poller")
      .eq("starred", false)
      .lt("created_at", cutoff)
      .select("id");
    if (error) throw error;
    return (data || []).length;
  } catch (e) {
    console.warn("news-ingest prune failed (non-fatal):", e.message);
    return 0;
  }
}

/**
 * Run the full ingest across all enabled sources. `sb` must be a service-role
 * client. Returns a summary the route hands back to the cron / Refresh button.
 */
export async function ingestSources(sb) {
  const orKey = process.env.OPENROUTER_API_KEY || null;

  const { data: sources, error } = await sb
    .from("monitor_sources")
    .select("*")
    .eq("enabled", true)
    .order("created_at", { ascending: true })
    .limit(MAX_SOURCES);
  if (error) throw new Error(error.message);
  if (!sources?.length) return { sources: 0, inserted: 0, errors: [] };

  let inserted = 0;
  const errors = [];

  const results = await Promise.allSettled(sources.map(async (src) => {
    try {
      const n = await ingestOne(sb, src, orKey);
      await sb.from("monitor_sources").update({
        last_fetched_at: new Date().toISOString(), last_status: "ok", item_count: n,
      }).eq("id", src.id);
      return n;
    } catch (e) {
      const msg = `error: ${String(e.message || e).slice(0, 200)}`;
      await sb.from("monitor_sources").update({
        last_fetched_at: new Date().toISOString(), last_status: msg,
      }).eq("id", src.id);
      errors.push({ source: src.name, error: msg });
      return 0;
    }
  }));
  for (const r of results) if (r.status === "fulfilled") inserted += r.value;

  const pruned = await pruneOld(sb);

  return { sources: sources.length, inserted, pruned, errors };
}
