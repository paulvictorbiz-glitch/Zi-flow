/**
 * POST /api/generate
 *
 * Generates a viral content draft (reel or longform) backed by real
 * FootageBrain footage. Server-side only — Anthropic API key never
 * reaches the browser.
 *
 * Request body:
 *   {
 *     prompt: string,
 *     type?: "reel"|"longform"|"youtube",
 *     reel_id?: string,
 *     provider?: "anthropic"|"openrouter",   // default "anthropic"
 *     prepare_only?: boolean,                // Puter client path — return prompt, no LLM
 *   }
 *
 * Response:
 *   200 JSON  — { draft, meta } structured draft (see outputSchema below),
 *               OR { clips, system, userMessage, meta } when prepare_only:true
 *   400       — missing prompt
 *   500       — upstream error / missing provider key
 */

import Anthropic from "@anthropic-ai/sdk";

// Free OpenRouter models can be slow (search + LLM + a few clips). Give the
// serverless function more headroom than the default so it doesn't 504 in
// production. 60s is the Hobby-plan ceiling; Pro can go higher.
export const config = { maxDuration: 60 };

const FB_API = "https://api.footagebrain.com/api";
const MAX_SEARCH_CLIPS = 8;    // reduced from 15 — fewer clips = less context = faster
const TRANSCRIPT_CLIPS = 3;    // reduced from 6 — top 3 with transcripts is enough
const MAX_CHUNKS_PER_CLIP = 4; // transcript chunks sent to LLM per clip
const MAX_CONTEXT_CLIPS = 14;  // cap clips sent to the LLM (country scoping can return many)

// ---------------------------------------------------------------------------
// Location / country scoping
//
// FootageBrain search is transcription-only and ignores the file path, but the
// library is organised into per-country folders (e.g. "...\1) Mobile\1) Taiwan\").
// So a "Taiwan food" query returns only clips that SAID "Taiwan". To pull a
// country's footage we search the TOPIC and filter results by the folder in
// abs_path. The country list is derived from the coverage tree (cached).
// ---------------------------------------------------------------------------
const FB_COVERAGE_URL = `${FB_API}/dashboard/coverage-tree`;

// Folder-name tokens that are storage/device labels, not places.
const NON_PLACE_TOKENS = new Set([
  "mobile", "drone", "gopro", "go pro", "osmo", "osmo pocket 3", "pocket",
  "compilation", "complilation", "travel", "pictures", "backup", "sd", "card",
  "capcut", "dcim", "lost", "files", "yellow", "black", "root", "raw",
  "footage", "clips", "misc", "test", "new", "old", "untitled",
]);

// Strip a leading "1) ", "4.5) ", "8. " ordinal prefix and lowercase.
function normCountry(s) {
  return String(s || "")
    .replace(/^\s*\d+(?:\.\d+)?\s*[\)\.]\s*/, "")
    .trim()
    .toLowerCase();
}

let _countryCache = { at: 0, list: [] };
async function getCountryList() {
  if (_countryCache.list.length && Date.now() - _countryCache.at < 10 * 60 * 1000) {
    return _countryCache.list;
  }
  try {
    const ct = await fetch(FB_COVERAGE_URL).then(r => r.json());
    const set = new Set();
    for (const root of ct.roots || []) {
      for (const f of root.folders || []) {
        const c = normCountry(f.rel_path);
        if (c && c.length >= 3 && !NON_PLACE_TOKENS.has(c)) set.add(c);
      }
    }
    _countryCache = { at: Date.now(), list: [...set].sort((a, b) => b.length - a.length) };
  } catch {
    /* keep stale list on failure */
  }
  return _countryCache.list;
}

// Find a known location name inside the prompt (longest match wins).
function detectCountry(prompt, list) {
  const p = " " + String(prompt || "").toLowerCase() + " ";
  for (const c of list) {            // list is pre-sorted longest-first
    if (c.length < 4) continue;
    const re = new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    if (re.test(p)) return c;
  }
  return null;
}

// Remove the country phrase from the topic query so semantic ranking is about
// the TOPIC, not the location (which the folder filter already handles).
function stripCountry(prompt, country) {
  if (!country) return prompt;
  const re = new RegExp(`\\b(?:in|from|at|around)?\\s*${country.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "ig");
  return String(prompt).replace(re, " ").replace(/\s{2,}/g, " ").trim();
}

// Does a clip's abs_path live under the given country's folder?
function clipInCountry(absPath, country) {
  if (!absPath || !country) return false;
  const segs = String(absPath).split(/[\\/]+/).map(normCountry);
  return segs.some(seg => seg === country || seg.includes(country));
}

// Recent file listing, cached in the warm container. The /api/files call is
// heavy (500 records) and identical regardless of country, so caching it makes
// the per-country top-up below nearly free after the first request.
let _filesCache = { at: 0, rows: [] };
async function getRecentFiles() {
  if (_filesCache.rows.length && Date.now() - _filesCache.at < 5 * 60 * 1000) {
    return _filesCache.rows;
  }
  try {
    const rows = await fetch(`${FB_API}/files?limit=500&sort_by=created_at_desc`).then(r => r.json());
    if (Array.isArray(rows) && rows.length) _filesCache = { at: Date.now(), rows };
  } catch {
    /* keep stale list on failure */
  }
  return _filesCache.rows;
}

// Pull a country's files straight from the folder listing (not search), so we
// can surface clips that have NO topical transcript — the ones transcription-
// only search can't find. Mapped into the search-result shape.
async function fetchCountryFiles(country, want = MAX_CONTEXT_CLIPS) {
  try {
    const rows = await getRecentFiles();
    const out = [];
    for (const f of rows || []) {
      if (out.length >= want) break;
      if (!clipInCountry(f.abs_path, country)) continue;
      out.push({
        video_file_id: f.id,
        filename: f.filename,
        abs_path: f.abs_path,
        duration_seconds: f.duration_seconds,
        thumbnail_path: f.thumbnail_path,
        is_vertical: f.is_vertical,
        drive_url: f.drive_url || null,
        drive_folder_url: f.drive_folder_url || null,
        best_score: 0,        // ranks below transcript-matched clips
        matched_chunks: [],
      });
    }
    return out;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// System prompt — viral content + SEO + hooks specialist
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are a viral short-form content strategist AND video editor for a travel creator.
You receive an idea and a list of real footage clips (with transcript excerpts).

Your job — produce a complete, ready-to-shoot reel package:
- HOOK: a scroll-stopping first line / first 3 seconds. Pattern interrupt, curiosity gap,
  or bold claim. Never generic. This is the single most important field.
- FLOW: a beat-by-beat blueprint (Hook → Build → Payoff → CTA) mapping the reel's structure
  with rough timecodes and what happens in each beat.
- CLIPS: pick the best real clips for each beat. Cite EXACT filenames + tight timecodes from
  the transcript. Never invent footage. Never use the same clip more than once — every pick
  must be a different video.
- SEO: a full YouTube/IG title, a complete Instagram caption (with line breaks, emojis, and a
  CTA), a 2-3 sentence SEO description with keywords front-loaded, and 15-20 hashtags
  (mix of broad reach + niche travel tags).

Be specific and usable — an editor should be able to cut this without asking questions.
Output valid JSON only — no markdown, no text outside the JSON. Start with "{".`;

// Quick / "Eco" mode — title + clip picks only. Far fewer output tokens:
// cheaper on the paid path, stretches Puter quota, less truncation risk on the
// free reasoning models. No hook / flow / SEO.
const QUICK_SYSTEM_PROMPT = `You are a fast video editor for a travel creator.
You receive an idea and a list of real footage clips (with transcript excerpts).
Pick the best real clips for the idea and give one short, punchy title.
Cite EXACT filenames + tight timecodes. Never invent footage.
Never repeat a clip — every pick must be a different video.
Do not write a hook, blueprint, or SEO — just the title and the clip picks.
Output valid JSON only — no markdown, no text outside the JSON. Start with "{".`;

// ---------------------------------------------------------------------------
// Helper: fetch FootageBrain search results
// ---------------------------------------------------------------------------
async function searchFootage(query, n = MAX_SEARCH_CLIPS) {
  const res = await fetch(`${FB_API}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, mode: "semantic", n_results: n }),
  });
  if (!res.ok) throw new Error(`FootageBrain search failed: ${res.status}`);
  const data = await res.json();
  return data.results || [];
}

// ---------------------------------------------------------------------------
// Helper: fetch transcript chunks for a clip (5s timeout)
// ---------------------------------------------------------------------------
async function fetchTranscript(fileId) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${FB_API}/files/${fileId}/transcript`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return [];
    const chunks = await res.json();
    return Array.isArray(chunks) ? chunks.slice(0, MAX_CHUNKS_PER_CLIP) : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Helper: format clips + transcripts into LLM context
// ---------------------------------------------------------------------------
function buildClipContext(clips, transcriptMap) {
  return clips.map((c, i) => {
    const chunks = transcriptMap[c.video_file_id] || [];
    const transcriptText = chunks.length
      ? chunks.map(ch =>
          `  [${fmtTime(ch.start_time)}–${fmtTime(ch.end_time)}] "${ch.text}"`
        ).join("\n")
      : "  (no transcript available)";

    return [
      `CLIP ${i + 1}:`,
      `  id: ${c.video_file_id}`,
      `  filename: ${c.filename}`,
      `  duration: ${c.duration_seconds ? Math.round(c.duration_seconds) + "s" : "unknown"}`,
      `  orientation: ${c.is_vertical ? "vertical" : "horizontal"}`,
      `  drive_url: ${c.drive_url || "not linked"}`,
      `  drive_folder_url: ${c.drive_folder_url || "not linked"}`,
      `  relevance_score: ${c.best_score?.toFixed(3) || "n/a"}`,
      `  transcript_excerpts:`,
      transcriptText,
    ].join("\n");
  }).join("\n\n");
}

function fmtTime(secs) {
  if (secs == null) return "??:??";
  const m = Math.floor(secs / 60).toString().padStart(2, "0");
  const s = Math.floor(secs % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

// ---------------------------------------------------------------------------
// JSON schema description sent to the LLM
// ---------------------------------------------------------------------------
function outputSchema(_type, mode = "full") {
  if (mode === "quick") {
    return `{
  "title": "punchy reel title, under 70 chars",
  "clips": [
    {
      "clip_id": "video_file_id from provided clips",
      "filename": "exact filename",
      "timecode_in": "MM:SS",
      "timecode_out": "MM:SS",
      "drive_url": "from clip data, or null",
      "note": "one-line editor note"
    }
  ]
}`;
  }
  return `{
  "title": "punchy reel title, under 70 chars",
  "description": "one sentence — what this reel is and why it works",
  "hook": "the exact opening line / on-screen text for the first 3 seconds",
  "flow": [
    { "beat": "Hook", "timecode": "0-3s", "direction": "what happens + why it stops the scroll" },
    { "beat": "Build", "timecode": "3-15s", "direction": "..." },
    { "beat": "Payoff", "timecode": "15-40s", "direction": "..." },
    { "beat": "CTA", "timecode": "40-50s", "direction": "..." }
  ],
  "clips": [
    {
      "clip_id": "video_file_id from provided clips",
      "filename": "exact filename",
      "timecode_in": "MM:SS",
      "timecode_out": "MM:SS",
      "drive_url": "from clip data, or null",
      "note": "one-line editor note tying this clip to a beat"
    }
  ],
  "seo": {
    "youtube_title": "SEO title under 70 chars with a curiosity gap",
    "ig_caption": "full Instagram caption with line breaks, emojis, and a CTA at the end",
    "description": "2-3 sentence SEO description, main keyword in the first sentence",
    "hashtags": ["#travel", "#... 15 to 20 total, mix broad + niche"]
  }
}`;
}

// ---------------------------------------------------------------------------
// Parse the model's text into a draft object (robust to ``` fences etc.)
// ---------------------------------------------------------------------------
function parseDraft(rawText, prompt) {
  try {
    let txt = (rawText || "").trim();
    txt = txt.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const jsonStart = txt.indexOf("{");
    const jsonEnd = txt.lastIndexOf("}") + 1;
    if (jsonStart === -1 || jsonEnd <= jsonStart) throw new Error("no JSON object found");
    return JSON.parse(txt.slice(jsonStart, jsonEnd));
  } catch (parseErr) {
    return {
      title: `Reel: ${prompt.slice(0, 50)}`,
      description: "(AI response could not be parsed — try Regenerate or another model)",
      clips: [],
      _raw: rawText,
      _parse_error: parseErr.message,
    };
  }
}

// ---------------------------------------------------------------------------
// Drop duplicate clip picks — the model sometimes repeats the same video to
// hit a requested count. Keep first occurrence, keyed by clip_id then filename.
// ---------------------------------------------------------------------------
function dedupeClips(clips) {
  if (!Array.isArray(clips)) return clips;
  const seen = new Set();
  return clips.filter(c => {
    const key = (c && (c.clip_id || c.filename)) || null;
    if (!key) return true;            // no identity — keep it
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Inject real drive_url / thumbnails from the search results by clip_id.
// ---------------------------------------------------------------------------
function injectClipData(draft, clips) {
  if (!draft || !Array.isArray(draft.clips)) return draft;
  const byId = Object.fromEntries(clips.map(c => [c.video_file_id, c]));
  draft.clips = dedupeClips(draft.clips).map(clip => {
    const src = byId[clip.clip_id] || {};
    return {
      ...clip,
      drive_url: src.drive_url || clip.drive_url || null,
      drive_folder_url: src.drive_folder_url || clip.drive_folder_url || null,
      thumbnail_path: src.thumbnail_path || null,
      duration_seconds: src.duration_seconds || null,
      is_vertical: src.is_vertical ?? clip.is_vertical ?? false,
    };
  });
  return draft;
}

// ---------------------------------------------------------------------------
// OpenRouter free tier — OpenAI-compatible chat completions.
//
// OpenRouter's free model slugs change over time (a hardcoded one will
// eventually 404 with "No endpoints found"). So we try a list of current
// free models in order, falling through on 404/429/503/empty-response to the
// next one. Keep the list fresh against https://openrouter.ai/api/v1/models
// (filter id endsWith ":free"). DeepSeek's free model was retired — these are
// the strongest reliably-available free instruct models as of 2026-06.
// ---------------------------------------------------------------------------
const OPENROUTER_FREE_MODELS = [
  "meta-llama/llama-3.3-70b-instruct:free", // non-reasoning, fast, great JSON — preferred when its free pool isn't saturated
  "z-ai/glm-4.5-air:free",                  // reliable fallback (reasoning — needs the larger max_tokens below)
  "qwen/qwen3-next-80b-a3b-instruct:free",
  "openai/gpt-oss-120b:free",
  "moonshotai/kimi-k2.6:free",              // extra backups for saturated days
  "nvidia/nemotron-3-super-120b-a12b:free",
];

// Remembered across warm invocations: the last model that actually answered.
// Free pools get saturated unpredictably, and every 429/503 fall-through still
// counts against the daily quota — so trying the known-good model FIRST cuts
// wasted attempts. Resets to null on a cold start (then we just use list order).
let lastWorkingModel = null;

// Order to try: last-working model first (if any), then the rest in list order,
// de-duplicated.
function modelTryOrder() {
  if (lastWorkingModel && OPENROUTER_FREE_MODELS.includes(lastWorkingModel)) {
    return [lastWorkingModel, ...OPENROUTER_FREE_MODELS.filter(m => m !== lastWorkingModel)];
  }
  return OPENROUTER_FREE_MODELS;
}

async function callOpenRouter(key, system, userMessage, maxTokens = 6000) {
  let lastErr = null;
  for (const model of modelTryOrder()) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://footagebrain.com",
          "X-Title": "FootageBrain Reel Generator",
        },
        body: JSON.stringify({
          model,
          // Several free models are reasoning models (glm, gpt-oss, qwen3).
          // For a structured "pick clips + title" task the thinking is overkill
          // and made them slow + token-hungry (it's what returned empty content
          // and risked production timeouts). Disable it where supported; models
          // that don't support the flag ignore it.
          reasoning: { enabled: false },
          max_tokens: maxTokens,
          messages: [
            { role: "system", content: system },
            { role: "user", content: userMessage },
          ],
        }),
      });

      // Model unavailable / rate-limited / overloaded → try the next one.
      if (res.status === 404 || res.status === 429 || res.status === 503) {
        const t = await res.text();
        lastErr = new Error(`OpenRouter ${res.status} for ${model}: ${t.slice(0, 160)}`);
        console.warn(lastErr.message, "— trying next free model");
        continue;
      }
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`OpenRouter ${res.status}: ${t.slice(0, 200)}`);
      }

      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || "";
      if (!text.trim()) {
        lastErr = new Error(`OpenRouter returned empty content from ${model}`);
        console.warn(lastErr.message, "— trying next free model");
        continue;
      }
      lastWorkingModel = model;   // remember for the next request (warm container)
      return {
        text,
        usage: {
          input_tokens: data.usage?.prompt_tokens,
          output_tokens: data.usage?.completion_tokens,
        },
        model,
      };
    } catch (e) {
      // Network-level failure for this model — record and try the next.
      lastErr = e;
      console.warn(`OpenRouter call failed for ${model}: ${e.message} — trying next free model`);
    }
  }
  throw lastErr || new Error("All OpenRouter free models failed");
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
export default async function handler(req, res) {
  // CORS for local dev
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }

  const {
    prompt,
    type = "reel",
    reel_id,
    provider = "anthropic",
    prepare_only = false,
    mode = "full",   // "full" = hook+flow+clips+SEO; "quick" = title + clips only
    clip_count,      // optional: ask the model for exactly this many clips (1–10)
    country,         // optional: scope retrieval to this country's folder ("" / "any" = off)
  } = req.body || {};
  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    res.status(400).json({ error: "prompt is required" });
    return;
  }

  // Optional exact clip count (clamped 1–10). null => let the model decide.
  const requestedClips = clip_count != null
    ? Math.max(1, Math.min(10, parseInt(clip_count, 10) || 0))
    : null;

  // Quick/Eco mode uses a leaner prompt + slim schema + a smaller token budget.
  // More clips need a little more output headroom in quick mode.
  const system = mode === "quick" ? QUICK_SYSTEM_PROMPT : SYSTEM_PROMPT;
  const anthropicMaxTokens = mode === "quick" ? 800 + (requestedClips || 0) * 60 : 2000;
  const openrouterMaxTokens = mode === "quick" ? 2500 + (requestedClips || 0) * 80 : 6000;

  // NOTE: no top-level API-key gate here. `prepare_only` (Puter client path)
  // and `openrouter` don't need ANTHROPIC_API_KEY — each provider checks its
  // own key below, just before it's used.

  try {
    // 0. Resolve the country to scope by: explicit param wins; otherwise try to
    //    auto-detect one from the prompt against the known folder list.
    const explicitCountry = (typeof country === "string" && country.trim() && country.trim().toLowerCase() !== "any")
      ? normCountry(country)
      : null;
    let scopeCountry = explicitCountry;
    let countryAutoDetected = false;
    if (!scopeCountry) {
      const detected = detectCountry(prompt, await getCountryList());
      if (detected) { scopeCountry = detected; countryAutoDetected = true; }
    }

    // 1. Search FootageBrain. When the caller asks for N clips, fetch a few
    //    extra so the model has real choices (capped at 15). When scoping by
    //    country we search the TOPIC only (folder filter handles location) and
    //    pull a much wider pool so enough survive the filter.
    const baseN = requestedClips
      ? Math.min(15, Math.max(MAX_SEARCH_CLIPS, requestedClips + 2))
      : MAX_SEARCH_CLIPS;
    const searchQuery = scopeCountry ? (stripCountry(prompt, scopeCountry) || prompt.trim()) : prompt.trim();

    let clips;
    let countryMatched = false;
    if (scopeCountry) {
      // Topic search + folder listing both hit the FootageBrain API; run them
      // in PARALLEL so country scoping stays well under the function timeout.
      const [searchClips, folderClips] = await Promise.all([
        searchFootage(searchQuery, 50),
        fetchCountryFiles(scopeCountry, MAX_CONTEXT_CLIPS),
      ]);
      // Topic-matched clips for this country first, then folder clips (which
      // surface silent/no-transcript footage that search alone can't), deduped.
      const scoped = searchClips.filter(c => clipInCountry(c.abs_path, scopeCountry));
      const seen = new Set();
      clips = [];
      for (const c of [...scoped, ...folderClips]) {
        if (clips.length >= MAX_CONTEXT_CLIPS) break;
        if (c.video_file_id && !seen.has(c.video_file_id)) { seen.add(c.video_file_id); clips.push(c); }
      }
      countryMatched = clips.length > 0;
      // Nothing at all for that country → fall back to an unscoped topic search.
      if (!clips.length) clips = await searchFootage(prompt.trim(), baseN);
    } else {
      clips = await searchFootage(searchQuery, baseN);
    }

    if (!clips.length) {
      res.status(200).json({ error: "no_footage", message: "No matching footage found in FootageBrain for this prompt." });
      return;
    }
    // Cap the pool sent to the LLM (a wide country search can return many).
    clips = clips.slice(0, scopeCountry ? MAX_CONTEXT_CLIPS : clips.length);

    // 2. Fetch transcripts for top N clips in parallel
    const topClips = clips.slice(0, TRANSCRIPT_CLIPS);
    const transcripts = await Promise.all(topClips.map(c => fetchTranscript(c.video_file_id)));
    const transcriptMap = {};
    topClips.forEach((c, i) => { transcriptMap[c.video_file_id] = transcripts[i]; });

    // Include remaining clips (no transcripts) for context
    const allContextClips = clips; // all returned clips
    const clipContext = buildClipContext(allContextClips, transcriptMap);

    // 3. Build user message
    const pickLine = requestedClips
      ? `Pick exactly ${requestedClips} clips (or as many as exist if fewer are available), each a DIFFERENT clip. Only use clips from the list above.`
      : `Pick the best clips for this reel. Only use clips from the list above.`;
    const userMessage = `Reel idea: "${prompt.trim()}"

Available footage (${clips.length} clips):

${clipContext}

${pickLine}
Return a single JSON object matching this schema exactly — nothing else:

${outputSchema(type, mode)}`;

    // 3b. prepare_only — the Puter (client-side Claude) path. Return the
    //     prompt + clips so the browser can call puter.ai.chat() itself, then
    //     parse + inject drive_urls client-side. No LLM call here.
    if (prepare_only) {
      res.status(200).json({
        clips,
        system,
        userMessage,
        prompt,
        meta: {
          clips_searched: clips.length,
          clips_with_transcripts: topClips.length,
          mode,
          country: scopeCountry || null,
          country_auto: countryAutoDetected,
          country_matched: countryMatched,
        },
      });
      return;
    }

    // 4. Call the chosen LLM provider
    let rawText = "";
    let usage = {};
    let providerModel = null;
    if (provider === "openrouter") {
      const key = process.env.OPENROUTER_API_KEY;
      if (!key) { res.status(500).json({ error: "OPENROUTER_API_KEY not configured on this server" }); return; }
      const or = await callOpenRouter(key, system, userMessage, openrouterMaxTokens);
      rawText = or.text;
      usage = or.usage;
      providerModel = or.model;
    } else { // anthropic (default)
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) { res.status(500).json({ error: "ANTHROPIC_API_KEY not configured on this server" }); return; }
      const client = new Anthropic({ apiKey });
      const message = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: anthropicMaxTokens,
        system,
        messages: [{ role: "user", content: userMessage }],
      });
      rawText = message.content?.[0]?.text || "";
      usage = {
        input_tokens: message.usage?.input_tokens,
        output_tokens: message.usage?.output_tokens,
      };
      providerModel = "claude-sonnet-4-6";
    }

    // 5 + 6. Parse the model's JSON robustly, then inject the real drive_url /
    //        drive_folder_url from the search results (don't trust the LLM to
    //        copy URLs verbatim out of the context).
    const draft = injectClipData(parseDraft(rawText, prompt), clips);

    res.status(200).json({
      draft,
      prompt,
      meta: {
        clips_searched: clips.length,
        clips_with_transcripts: topClips.length,
        ...usage,
        provider,
        model: providerModel,
        mode,
        country: scopeCountry || null,
        country_auto: countryAutoDetected,
        country_matched: countryMatched,
      },
    });

  } catch (err) {
    console.error("generate error:", err);
    res.status(500).json({ error: err.message || "generation failed" });
  }
}
